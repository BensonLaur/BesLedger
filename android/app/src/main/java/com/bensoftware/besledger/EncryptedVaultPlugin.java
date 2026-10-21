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
        helper = new SQLiteOpenHelper(getContext(), "besledger-vault.db", null, 1) {
            @Override public void onCreate(SQLiteDatabase db) {
                db.execSQL("CREATE TABLE vault (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL, previous TEXT)");
            }
            @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
                // 未知迁移必须报错；禁止删除原库后重新创建。
                throw new IllegalStateException("数据库升级路径尚未支持");
            }
        };
        helper.setWriteAheadLoggingEnabled(true);
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
