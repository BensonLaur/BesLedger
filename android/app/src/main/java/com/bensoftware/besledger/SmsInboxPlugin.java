package com.bensoftware.besledger;

import android.Manifest;
import android.database.Cursor;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.Set;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "SmsInbox", permissions = @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }))
public class SmsInboxPlugin extends Plugin {
    // Set.of 从 API 30 才可用；本应用最低 API 29，静态初始化也必须兼容。
    private static final Set<String> SENDERS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "95588", "95533", "95599", "95566", "95555", "95559", "95580"
    )));
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static final Pattern PRIVATE_CODE = Pattern.compile("验证码|动态口令|校验码");
    private static final Pattern MOVEMENT = Pattern.compile("支出|消费|收入|入账|扣款|扣收|到账|存入|实付|支付|转账|转入|转出|退款|冲正|还款成功|还款已完成");

    @PluginMethod
    public void query(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) { requestPermissionForAlias("sms", call, "afterPermission"); return; }
        readSelectedRange(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) { call.reject("短信权限被拒绝或安装渠道不允许，请继续使用备注粘贴"); return; }
        readSelectedRange(call);
    }

    private void readSelectedRange(PluginCall call) {
        String sender = call.getString("sender", "");
        // 毫秒时间戳由 JSON 解析为 Long，getDouble 不接受 Long，会误判正常日期范围。
        Long start = call.getLong("start"), end = call.getLong("end");
        if (!SENDERS.contains(sender) || start == null || end == null || start < 0 || end < start || end - start > 31L * 86400000L) {
            call.reject("请选择银行发送方及不超过 31 天的日期范围"); return;
        }
        worker.execute(() -> {
            JSArray messages = new JSArray();
            String[] args = { String.valueOf(start.longValue()), String.valueOf(end.longValue()), sender };
            // 只查询用户选定日期和银行发送方，不申请默认短信应用或后台接收权限。
            try (Cursor cursor = getContext().getContentResolver().query(Uri.parse("content://sms/inbox"), new String[]{"_id", "body", "date"}, "date >= ? AND date <= ? AND address = ?", args, "date DESC")) {
                if (cursor != null) while (cursor.moveToNext() && messages.length() < 200) {
                    String body = cursor.getString(1);
                    // 先排除认证短信，完成交易的字段核对由共用识别流程处理。
                    if (body == null || PRIVATE_CODE.matcher(body).find() || !MOVEMENT.matcher(body).find()) continue;
                    JSObject item = new JSObject(); item.put("id", cursor.getString(0)); item.put("body", body); item.put("date", cursor.getLong(2)); messages.put(item);
                }
                JSObject result = new JSObject(); result.put("messages", messages); call.resolve(result);
            } catch (SecurityException ignored) { call.reject("系统已撤回或限制短信权限，请改用粘贴"); }
            catch (Exception ignored) { call.reject("短信读取失败，请改用粘贴"); }
        });
    }

    @Override protected void handleOnDestroy() { worker.shutdown(); }
}
