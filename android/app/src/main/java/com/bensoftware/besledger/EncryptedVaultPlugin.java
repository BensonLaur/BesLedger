package com.bensoftware.besledger;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "EncryptedVault")
public class EncryptedVaultPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SQLiteOpenHelper helper;

    @Override
    public void load() {
        helper = new SQLiteOpenHelper(getContext(), "besledger-vault.db", null, 2) {
            @Override public void onCreate(SQLiteDatabase db) {
                db.execSQL("CREATE TABLE vault (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL, previous TEXT)");
                createCredentialTable(db);
            }
            @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
                // 只新增独立凭证表，账本与上一版本不改动；凭证不保留历史副本。
                if (oldVersion == 1 && newVersion == 2) createCredentialTable(db);
                else throw new IllegalStateException("数据库升级路径尚未支持");
            }
        };
        helper.setWriteAheadLoggingEnabled(true);
    }

    private static void createCredentialTable(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE credentials (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT)");
    }

    @PluginMethod
    public void readCredential(PluginCall call) {
        worker.execute(() -> {
            try (Cursor row = helper.getReadableDatabase().rawQuery("SELECT revision,payload FROM credentials WHERE id=1", null)) {
                JSObject result = new JSObject();
                if (row.moveToFirst()) {
                    JSObject value = new JSObject();
                    value.put("id", "github"); value.put("revision", row.getLong(0));
                    value.put("payload", row.isNull(1) ? org.json.JSONObject.NULL : row.getString(1));
                    result.put("value", value);
                }
                call.resolve(result);
            } catch (Exception ignored) { call.reject("无法读取本机登录凭证，原数据保留"); }
        });
    }

    @PluginMethod
    public void compareSwapCredential(PluginCall call) {
        final Integer expected = call.getInt("expected");
        final String payload = call.getString("payload");
        if (expected == null || expected < 0 || !call.getData().has("payload") || (payload != null && payload.length() > 100_000)) {
            call.reject("凭证存储参数无效"); return;
        }
        worker.execute(() -> {
            SQLiteDatabase db = null;
            try {
                db = helper.getWritableDatabase();
                db.beginTransaction();
                long revision = 0;
                try (Cursor row = db.rawQuery("SELECT revision FROM credentials WHERE id=1", null)) {
                    if (row.moveToFirst()) revision = row.getLong(0);
                }
                boolean saved = revision == expected.longValue();
                if (saved) {
                    ContentValues values = new ContentValues();
                    values.put("id", 1); values.put("revision", revision + 1);
                    if (payload == null) values.putNull("payload"); else values.put("payload", payload);
                    db.replaceOrThrow("credentials", null, values);
                }
                db.setTransactionSuccessful();
                db.endTransaction();
                JSObject result = new JSObject(); result.put("saved", saved); call.resolve(result);
            } catch (Exception ignored) { call.reject("无法保存登录状态，请重试；账目未改动"); }
            finally { if (db != null && db.inTransaction()) db.endTransaction(); }
        });
    }

    @PluginMethod
    public void read(PluginCall call) {
        worker.execute(() -> {
            try (Cursor row = helper.getReadableDatabase().rawQuery("SELECT revision,payload,previous FROM vault WHERE id=1", null)) {
                JSObject result = new JSObject();
                if (row.moveToFirst()) {
                    JSObject value = new JSObject();
                    value.put("id", "vault"); value.put("revision", row.getLong(0)); value.put("payload", row.getString(1));
                    if (!row.isNull(2)) value.put("previous", row.getString(2));
                    result.put("value", value);
                }
                call.resolve(result);
            } catch (Exception ignored) { call.reject("无法读取本地加密数据库，原文件保留"); }
        });
    }

    @PluginMethod
    public void compareSwap(PluginCall call) {
        final Integer expected = call.getInt("expected");
        final String payload = call.getString("payload");
        if (expected == null || expected < 0 || payload == null || payload.length() > 50_000_000) {
            call.reject("存储参数无效"); return;
        }
        worker.execute(() -> {
            SQLiteDatabase db = null;
            try {
                db = helper.getWritableDatabase();
                db.beginTransaction();
                try (Cursor row = db.rawQuery("SELECT revision,payload FROM vault WHERE id=1", null)) {
                long revision = 0; String previous = null;
                if (row.moveToFirst()) { revision = row.getLong(0); previous = row.getString(1); }
                if (revision != expected.longValue()) { call.reject("本机账本版本已改变，请重新解锁；草稿未清空"); return; }
                ContentValues values = new ContentValues();
                values.put("id", 1); values.put("revision", revision + 1); values.put("payload", payload); values.put("previous", previous);
                db.replaceOrThrow("vault", null, values);
                db.setTransactionSuccessful();
                JSObject result = new JSObject(); result.put("revision", revision + 1);
                // 只有事务真正提交后才通知 Web 层保存成功。
                db.endTransaction(); call.resolve(result);
                }
            } catch (Exception ignored) { call.reject("保存失败，原账本与草稿保留"); }
            finally { if (db != null && db.inTransaction()) db.endTransaction(); }
        });
    }

    @Override
    protected void handleOnDestroy() {
        worker.execute(() -> { if (helper != null) helper.close(); });
        worker.shutdown();
    }
}
