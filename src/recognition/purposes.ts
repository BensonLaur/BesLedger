type PurposeRule = [RegExp, string[]];
const expenseRules: PurposeRule[] = [
  [/早餐|早饭|早飯|早膳|早点|早點/, ['expense.food.001']],
  [/午餐|午饭|午膳/, ['expense.food.002']],
  [/晚餐|晚饭|晚膳/, ['expense.food.003']],
  [/夜宵|宵夜/, ['expense.food.004']],
  [/零食|薯片|饼干|糖果/, ['expense.food.005']],
  [/水果|饮料|奶茶|果汁|矿泉水/, ['expense.food.006']],
  [/买菜|菜市场|蔬菜|生鲜|买肉|猪肉|牛肉|鸡蛋/, ['expense.food.007']],
  [/酱油|食用油|调味|油盐酱醋/, ['expense.food.008']],
  [/打车|出租车|的士|网约车|滴滴|搭的/, ['expense.transport.001']],
  [/公交|巴士/, ['expense.transport.002']],
  [/加油|汽油|柴油|石油|石化/, ['expense.transport.003']],
  [/停车|泊车|车位费|停車/, ['expense.transport.004']],
  [/地铁|轻轨|捷运/, ['expense.transport.005']],
  [/火车|高铁|动车/, ['expense.transport.006']],
  [/长途汽车|大巴/, ['expense.transport.007']],
  [/机票|飞机票|航班/, ['expense.transport.008']],
  [/共享单车|自行车|骑行/, ['expense.transport.009']],
  [/洗车|修车|汽车保养|换轮胎/, ['expense.transport.011']],
  [/过路费|过桥费|高速费|通行费|路桥费/, ['expense.transport.012']],
  [/车险|交强险/, ['expense.transport.015']],
  [/衣服|买衣|鞋子|买鞋|服饰|背包/, ['expense.shopping.001']],
  [/百货|日用品|纸巾|洗衣液|洗洁精|牙膏/, ['expense.shopping.002']],
  [/尿不湿|纸尿裤|奶粉|婴儿用品/, ['expense.shopping.003']],
  [/化妆品|护肤|口红|面霜/, ['expense.shopping.004']],
  [/买烟|香烟|买酒/, ['expense.shopping.005']],
  [/买手机|耳机|数码|键盘|鼠标/, ['expense.shopping.006']],
  [/文具|玩具/, ['expense.shopping.007']],
  [/买书|书籍|杂志/, ['expense.shopping.008']],
  [/旅游|度假|景区|门票/, ['expense.leisure.001']],
  [/电影|影票|影院/, ['expense.leisure.002']],
  [/游戏充值|电玩/, ['expense.leisure.003']],
  [/健身|游泳|羽毛球|篮球|瑜伽/, ['expense.leisure.006']],
  [/宠物|猫粮|狗粮/, ['expense.leisure.007']],
  [/咖啡|喝茶|酒吧/, ['expense.leisure.009']],
  [/视频会员|影音会员|音乐会员/, ['expense.leisure.012']],
  [/药店|药品|买药/, ['expense.health-education.001']],
  [/挂号|门诊|看病/, ['expense.health-education.002']],
  [/住院/, ['expense.health-education.004']],
  [/培训|考试|报名费/, ['expense.health-education.007']],
  [/学费/, ['expense.health-education.009']],
  [/话费|通讯费|手机充值|电话费/, ['expense.home.001']],
  [/电费|水费|燃气|煤气|水电/, ['expense.home.002']],
  [/理发|剪发|美发|美容/, ['expense.home.004']],
  [/房租|住宿|酒店|宾馆|租房/, ['expense.home.005']],
  [/快递|邮费|邮政|运费/, ['expense.home.008']],
  [/宽带|网费/, ['expense.home.009']],
  [/保洁|家政|钟点工/, ['expense.home.010']],
  [/物业/, ['expense.home.011']],
  [/税费|手续费/, ['expense.home.012']],
  [/保险费|保费/, ['expense.home.013']],
  [/送红包|发红包|随礼|份子钱|礼金/, ['expense.social.001']],
  [/送礼|礼物/, ['expense.social.002']],
  [/孝敬/, ['expense.social.003']],
  [/请客/, ['expense.social.004']],
  [/捐款|捐赠/, ['expense.social.006']],
];
const incomeRules: PurposeRule[] = [
  [/工资|薪水|代发薪/, ['income.001']],
  [/奖金|年终奖/, ['income.002']],
  [/兼职|外快|稿费/, ['income.003']],
  [/营业收入/, ['income.004']],
  [/销售款|货款/, ['income.005']],
  [/红包/, ['income.006']],
  [/礼金/, ['income.007']],
  [/报销/, ['income.008']],
  [/补贴|福利/, ['income.009']],
  [/利息/, ['income.011']],
  [/分红/, ['income.012']],
  [/租金|房租/, ['income.013']],
  [/公积金/, ['income.014']],
  [/赔付/, ['income.016']],
];
const mealNames: Record<string, string> = {
  'expense.food.001': '早餐',
  'expense.food.002': '午餐',
  'expense.food.003': '晚餐',
  'expense.food.004': '夜宵',
};
const mealPattern =
  /包点|包點|包子|豆浆|豆漿|肠粉|腸粉|餐厅|餐廳|餐饮|餐飲|餐费|餐費|吃饭|吃飯|饭店|飯店|食堂|快餐|外卖|外賣|面馆|麵館|面店|麵店|拉面|拉麵|粥店|小吃/;
export function recognizePurpose(text: string, type?: 'expense' | 'income' | 'refund', writtenTime?: string) {
  const rules = type === 'income' ? incomeRules : type === 'refund' ? [] : expenseRules;
  const matches = rules.flatMap(([pattern, ids]) => (pattern.test(text) ? ids : []));
  let basis = '';
  if (type !== 'income' && type !== 'refund') {
    // 明写的餐次和具体食物分类优先；只有笼统餐饮用途才参考原文时间，不读当前时钟。
    if (!matches.some((id) => id.startsWith('expense.food.')) && mealPattern.test(text)) {
      const hour = writtenTime ? Number(writtenTime.slice(0, 2)) : undefined;
      const meal =
        hour === undefined
          ? undefined
          : hour >= 5 && hour < 11
            ? 'expense.food.001'
            : hour >= 11 && hour < 15
              ? 'expense.food.002'
              : hour >= 17 && hour < 21
                ? 'expense.food.003'
                : hour >= 21 || hour < 5
                  ? 'expense.food.004'
                  : undefined;
      if (meal) {
        matches.push(meal);
        basis = `已识别餐饮用途，按备注时间 ${writtenTime!.slice(0, 5)} 推荐${mealNames[meal]}，请核对`;
      } else {
        matches.push(...Object.keys(mealNames));
        basis = '已识别餐饮用途，用餐时段不明确，请选择早餐、午餐、晚餐或夜宵';
      }
    }
    if (!matches.length && /超市/.test(text)) matches.push('expense.food.007', 'expense.shopping.002');
  }
  return { categoryIds: [...new Set(matches)], basis };
}
