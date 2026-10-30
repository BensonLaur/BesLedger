import { describe, expect, it } from 'vitest';
import { recognize } from '../src/recognition/sms';
import { list } from '../src/domain/model';
import { builtins } from '../src/domain/categories';
import { fixture } from './fixtures';
const accounts = list(fixture(), 'account');
const now = new Date('2026-10-30T12:00:00+08:00');
const parse = (text: string) => recognize(text, accounts, now);

describe('手写备注金额：人工列出的常见输入，以整数分核对', () => {
  it.each([
    ['停车费10元', 1000],
    ['停车费10块', 1000],
    ['停车费 10元', 1000],
    ['停车费 10 元', 1000],
    ['停车费\n10\t块钱', 1000],
    ['10元停车费', 1000],
    ['停车费１０．５０元', 1050],
    ['停车费￥１０．５０', 1050],
    ['停车费¥ 10', 1000],
    ['停车费人民币10元', 1000],
    ['停车费人民币 10.50', 1050],
    ['停车费10人民币', 1000],
    ['停车费RMB10.50', 1050],
    ['停车费10 CNY', 1000],
    ['停车费10圆', 1000],
    ['停车费10.5块', 1050],
    ['停车费10.05元', 1005],
    ['停车费0.01元', 1],
    ['停车费.5元', 50],
    ['停车费00010元', 1000],
    ['停车费+10元', 1000],
    ['停车费1,234.56元', 123456],
    ['停车费1,234,567.89元', 123456789],
    ['停车费10块5', 1050],
    ['停车费10元5角', 1050],
    ['停车费10块5毛6分', 1056],
    ['停车费10元05分', 1005],
    ['停车费一元二分', 102],
    ['停车费五毛', 50],
    ['停车费5毛', 50],
    ['停车费5毛6分', 56],
    ['停车费0.5毛', 5],
    ['停车费5分钱', 5],
    ['停车费十元', 1000],
    ['停车费十二元', 1200],
    ['停车费二十五元', 2500],
    ['停车费两块五毛', 250],
    ['停车费一百零五元', 10500],
    ['停车费一千零二元', 100200],
    ['停车费壹佰贰拾叁元肆角伍分', 12345],
    ['停车费一百二十元整', 12000],
    ['停车费二点五元', 250],
    ['停车费一万两千三百四十五元', 1234500],
    ['停车费1.2万元', 1200000],
    ['停车费1.234万元', 1234000],
    ['停车费10', 1000],
    ['停车费 10.5', 1050],
    ['10 停车费', 1000],
    ['10', 1000],
    ['6000 工资', 600000],
    ['午餐 25', 2500],
    ['停车2小时 10', 1000],
    ['地铁2号线 8', 800],
    ['2026-09-01 停车费10', 1000],
    ['9月1日08:09 停车费10', 1000],
    ['订单号123456 停车费10元', 1000],
    ['尾号1234卡停车费10元', 1000],
    ['停车10分钟付费10元', 1000],
    ['停车费10元，停了5分钟', 1000],
    ['停车费10元 5分钟', 1000],
    ['停车费10元 5个人', 1000],
    ['停车费10元2小时', 1000],
    ['午餐20元2人', 2000],
    ['午餐20元 2 份', 2000],
    ['早餐10元1瓶水', 1000],
    ['停车费¥10，早餐', 1000],
    ['普通记录25元', 2500],
    ['微信支付停车费10元', 1000],
    ['支付宝停车费10元', 1000],
    ['原价20元，优惠5元，实付15元', 1500],
    ['停车费10元，优惠2元', 1000],
    ['单价10元，买了2份，合计20元', 2000],
    ['早餐10元，午餐20元，总共30元', 3000],
    ['停车费20元，实付18元', 1800],
    ['消费10元，实际扣款10元', 1000],
    ['余额100元，停车费10元', 1000],
    ['余额100元，停车费10', 1000],
    ['停车费10，余额100元', 1000],
    ['优惠券5元，停车费10', 1000],
    ['停车费10元，余额90元', 1000],
    ['余额0元，停车费10元', 1000],
    ['可用额度1000元，支出停车费10元', 1000],
    ['停车费10元，找零40元', 1000],
    ['停车费10元，单价5元/小时', 1000],
    ['收到工资6000元', 600000],
    ['收到报销款80.08元', 8008],
    ['停车费退款10块', 1000],
  ] as const)('%s → %i 分', (text, amount) => {
    const result = parse(text);
    expect(result.amount).toBe(amount);
    expect(result.amountSource).toBeTruthy();
  });
});
describe('金额边界：不能把时间、编号、余额、外币及歧义当实际金额', () => {
  it.each([
    '',
    '没有金额',
    '停车费',
    '停车2小时',
    '停车10分钟',
    '9月1日08:09',
    '地铁2号线',
    '停车场A123',
    '停车场编号123456',
    '停车订单号20260901',
    '停车场电话13800138000',
    '买iPhone15',
    '只有余额100元',
    '可用余额1,500.00元',
    '停车费原价20元',
    '停车费优惠券10元',
    '停车费预算100元',
    '停车费10元/小时',
    '停车费-10元',
    '停车费−10元',
    '停车费负十元',
    '停车费0元',
    '停车费1.234元',
    '停车费1.23毛',
    '停车费1.5分',
    '停车费10元5角6',
    '停车费1,23元',
    '停车费1..2元',
    '停车费1e3元',
    '停车费1/2元',
    '停车费10.元',
    '停车费90071992547409.92元',
    '停车费一百二元',
    '停车费三千五元',
    '停车费十百元',
    '停车费10美元',
    '消费USD20.00元',
    '停车费HKD10',
    '停车费10港元',
    '停车费10日元',
    '停车费€10',
    '停车费人民币10元，USD2',
    '停车费未支付10元',
    '计划花10元买午餐',
    '停车费支付失败10元',
    '停车费10元已免单',
    '早餐10元，午餐20元',
    '早餐10元，晚餐10元',
    '停车费10元或20元',
    '实付10元，实付20元',
    '停车费10+20',
    '午餐 10 晚餐20',
  ])('%s 不擅自填金额', (text) => expect(parse(text).amount).toBeUndefined());
  it('多个交易保留各候选、不相加；有实付时仍能核对其他数字', () => {
    const r = parse('早餐10元，午餐20元，余额90元');
    expect(r.amountCandidates.map((c) => c.amount)).toEqual([1000, 2000]);
    expect(r.balance).toBe(9000);
    expect(r.warnings.join()).toContain('多个交易金额');
    expect(parse('余额100元，停车费10元').balance).toBe(10000);
    expect(parse('停车费10元，余额0元').balance).toBe(0);
    expect(parse('停车费10元，余额100').balance).toBe(10000);
    expect(parse('原价20元，优惠5元，实付15元').amountCandidates.map((c) => c.amount)).toEqual([1500]);
  });
  it('金额无单位明确提示；金额、类型、用途与时间分别识别', () => {
    expect(parse('停车费 10').warnings.join()).toContain('未写单位');
    expect(parse('停车费10元').type).toBe('expense');
    expect(parse('普通记录25元').type).toBeUndefined();
    expect(parse('普通记录25元').at).toBeUndefined();
    expect(parse('转账支付10元').type).toBeUndefined();
    expect(parse('停车费退款10元').type).toBe('refund');
    expect(parse('收到工资6000元').type).toBe('income');
    expect(parse('支付宝停车费10元').type).toBe('expense');
  });
  it('超长备注和巨额数字返回待确认，不抛错或阻塞', () => {
    expect(() => parse('停车费' + '9'.repeat(20000) + '元')).not.toThrow();
    expect(parse('停车费' + '9'.repeat(20000) + '元').amount).toBeUndefined();
    expect(parse('停车费' + '一'.repeat(20000)).amount).toBeUndefined();
  });
});
describe('用途同义词只推荐候选，支付渠道、收入与退款保持独立', () => {
  it.each([
    ['停车费10元', 'expense.transport.004'],
    ['泊车10块', 'expense.transport.004'],
    ['车位费10元', 'expense.transport.004'],
    ['滴滴35元', 'expense.transport.001'],
    ['的士35元', 'expense.transport.001'],
    ['出租车35元', 'expense.transport.001'],
    ['公交2块', 'expense.transport.002'],
    ['加油200元', 'expense.transport.003'],
    ['捷运6元', 'expense.transport.005'],
    ['高铁100元', 'expense.transport.006'],
    ['机票500元', 'expense.transport.008'],
    ['共享单车2元', 'expense.transport.009'],
    ['高速费30元', 'expense.transport.012'],
    ['洗车30元', 'expense.transport.011'],
    ['早饭8元', 'expense.food.001'],
    ['豆浆3块', 'expense.food.001'],
    ['午饭25元', 'expense.food.002'],
    ['晚餐餐厅50元', 'expense.food.003'],
    ['宵夜30块', 'expense.food.004'],
    ['买菜20块', 'expense.food.007'],
    ['奶茶15块', 'expense.food.006'],
    ['纸巾12元', 'expense.shopping.002'],
    ['买鞋99元', 'expense.shopping.001'],
    ['买书30元', 'expense.shopping.008'],
    ['电影票40元', 'expense.leisure.002'],
    ['猫粮80元', 'expense.leisure.007'],
    ['咖啡18元', 'expense.leisure.009'],
    ['挂号20元', 'expense.health-education.002'],
    ['买药30元', 'expense.health-education.001'],
    ['手机充值50元', 'expense.home.001'],
    ['燃气费60元', 'expense.home.002'],
    ['剪发30元', 'expense.home.004'],
    ['房租1000元', 'expense.home.005'],
    ['邮费8元', 'expense.home.008'],
    ['网费100元', 'expense.home.009'],
    ['物业120元', 'expense.home.011'],
    ['送红包100元', 'expense.social.001'],
    ['捐款10元', 'expense.social.006'],
    ['工资6000元', 'income.001'],
    ['奖金200元', 'income.002'],
    ['收到报销80元', 'income.008'],
    ['收到房租1000元', 'income.013'],
    ['利息到账2元', 'income.011'],
    ['收到红包20元', 'income.006'],
  ])('%s → %s', (text, id) => {
    expect(parse(text).categoryIds).toEqual([id]);
    expect(builtins.find((c) => c.id === id)).toBeDefined();
  });
  it('弱用途和两种用途并存不静默选一类，商户显式规则优先', () => {
    expect(parse('超市20元').categoryIds).toHaveLength(2);
    expect(parse('餐厅50元').categoryIds).toEqual(['expense.food.002', 'expense.food.003']);
    expect(parse('早餐10元，地铁6元').categoryIds).toHaveLength(2);
    expect(parse('消费财付通20元').categoryIds).toEqual([]);
    expect(parse('支付宝20元').categoryIds).toEqual([]);
    expect(parse('消费10美元，余额20美元').balance).toBeUndefined();
    expect(parse('退款停车费10元').categoryIds).toEqual([]);
    expect(parse('收到停车费10元').categoryIds).toEqual([]);
    expect(
      recognize('示例小店午餐25元', accounts, now, { 示例小店: 'expense.food.009' }).categoryIds,
    ).toEqual(['expense.food.009']);
  });
});
