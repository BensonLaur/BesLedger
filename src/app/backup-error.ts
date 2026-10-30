export function backupError(error: unknown, recovery: boolean): Error {
  if (error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError'))
    return new Error('无法读取这份备份，请确认文件完整，或使用更新版本的 Bes记账。原有账目未改动。');
  if (error instanceof Error && error.message === '恢复密钥必须是完整的 64 位字符')
    return new Error('恢复密钥不完整，请完整粘贴保存的内容。');
  if (error instanceof Error && error.message === '密钥不匹配或数据已损坏，原数据未改动')
    return new Error(
      `未能解密备份，请核对${recovery ? '恢复密钥' : '备份原密码'}，并确认文件完整。原有账目未改动。`,
    );
  return error instanceof Error ? error : new Error('未能读取备份，原有账目未改动。');
}
