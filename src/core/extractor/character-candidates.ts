/**
 * @deprecated SPIKE / debug only — NOT the product name-discovery path.
 * Spec: docs/superpowers/specs/2026-07-18-character-name-scan-design.md
 * Product path: Flash unit scan + frequency gate (character-extract-job).
 *
 * Program-first character name candidates (full-text scan).
 */

export interface CharacterCandidate {
  name: string;
  /** Rough importance score (frequency + speech hits + span) */
  score: number;
  count: number;
  /** Distinct rough "chapter buckets" (by offset windows) this name appears in */
  spanBuckets: number;
  firstOffset: number;
  lastOffset: number;
  /** How many times seen as speech subject (X说/道/…) */
  speechHits: number;
  /** Sample evidence lines for LLM */
  evidence: string[];
  sources: Array<"speech" | "address" | "freq">;
}

export interface ScanCandidatesOptions {
  /** Min total occurrences (default scales with length) */
  minCount?: number;
  /** Max candidates to return */
  maxCandidates?: number;
  /** Evidence snippets per name */
  maxEvidence?: number;
  /** Bucket size for span counting (chars) */
  bucketSize?: number;
}

/** Baijiaxing + extras common in web novels (incl. 洛 etc.) */
const COMPOUND_SURNAMES = [
  "万俟", "司马", "上官", "欧阳", "夏侯", "诸葛", "闻人", "东方", "赫连", "皇甫",
  "尉迟", "公羊", "澹台", "公冶", "宗政", "濮阳", "淳于", "单于", "太叔", "申屠",
  "公孙", "仲孙", "轩辕", "令狐", "钟离", "宇文", "长孙", "慕容", "鲜于", "闾丘",
  "司徒", "司空", "端木", "独孤", "南宫", "西门", "东郭", "南门", "呼延", "羊舌",
  "微生", "梁丘", "左丘", "百里", "东门",
];

const SINGLE_SURNAMES =
  "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴鬱胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公晋楚闫法汝鄢涂钦岳帅缑亢况有琴商牟佘佴伯赏墨哈谯笪年爱阳佟第五洛叶甘武";

const SURNAME_1 = new Set(SINGLE_SURNAMES.split("").filter(Boolean));
const SURNAME_2 = new Set(COMPOUND_SURNAMES);

/** Words that look like names but are usually not characters */
const BLACKLIST = new Set([
  "什么", "怎么", "为什么", "我们", "你们", "他们", "她们", "自己", "这个", "那个",
  "时候", "地方", "东西", "事情", "问题", "感觉", "样子", "声音", "眼睛",
  "今天", "明天", "昨天", "现在", "以后", "以前", "突然", "于是", "因为", "所以",
  "如果", "虽然", "但是", "然后", "接着", "同时", "已经", "还是", "或者", "并且",
  "先生", "小姐", "太太", "夫人", "老师", "同学", "朋友", "哥哥", "姐姐", "弟弟",
  "妹妹", "爸爸", "妈妈", "父亲", "母亲", "儿子", "女儿", "老公", "老婆", "丈夫",
  "妻子", "男友", "女友", "老板", "同事", "司机", "警察", "医生", "护士",
  "北京", "上海", "广州", "深圳", "杭州", "南京", "成都", "重庆", "武汉", "西安",
  "中国", "美国", "日本", "公司", "学校", "大学", "家里", "房间", "客厅", "厨房",
  "手机", "电脑", "微信", "消息", "电话", "时间", "工作", "生活", "世界", "人生",
  "一个", "两个", "几个", "一些", "有人", "没人", "别人", "大家", "所有人",
  "第一", "第二", "第三", "这里", "那里", "哪里", "怎么会", "怎么办",
  "知道", "觉得", "看到", "听到", "想到", "回来", "出去", "过来", "过去",
  "开始", "结束", "继续", "发现", "以为", "好像", "似乎",
  "少爷", "大哥", "大姐", "老弟", "老姐",
  "马上", "有点", "有些", "有什么", "但她", "但他", "不过",
  "其实", "当然", "可能", "应该", "竟然", "居然",
  "可以", "都不", "每一", "一道", "也就是", "与其", "仿佛", "却不",
  "终于", "只能", "有种", "有一", "一声", "更别", "更不", "更不用",
  "都知", "经知", "都充", "成了一", "勾起一", "宛如一", "有一丝", "有着一",
  "都没有", "有任何", "毫无疑", "那一", "成一", "轻声", "莫名", "莫名的",
  "管怎么", "温呵呵", "李动轻", "温轻", "羊肠", "通人", "一边", "一会儿",
  "舒服", "沙发", "游戏", "干嘛", "房间里", "这话", "我是",
  "这样", "那样", "怎样", "如何", "之后", "之前", "之间", "其中",
  "自己的", "他们的", "我们的", "你们的", "一个人", "这一点",
  "身体", "心里", "眼中", "面前", "身后", "手中", "心中",
  "时候", "时候的", "情况下", "意义上",
  // High-freq Chinese that start with surname-looking chars (pollute full-text scan)
  "都是", "那么", "那个", "那里", "那些", "那种", "那样", "那是", "那份",
  "能够", "能力", "却是", "却又", "却不", "任何", "如何", "因此",
  "越来越", "明显", "曲线", "程度", "张开", "双腿", "水光", "包裹", "都被",
  "尤其是", "明白", "曾经", "毕竟", "水声", "高潮", "后一", "丰腴", "简直",
  "都会", "左右", "红唇", "相比", "阴道", "有什", "充血", "花心", "空气",
  "时不时", "经不", "第一次", "有多", "强烈的", "白浆", "花唇", "阴唇",
  "都没", "已经", "以后", "以来", "以上", "以下", "以及", "以外",
  "不是", "不会", "不能", "不要", "不过", "不只", "不论", "不管",
  "只是", "只能", "只要", "只有", "只见", "只觉",
  "还是", "还有", "还在", "还没", "还要",
  "就是", "就在", "就要", "就算", "就会",
  "但是", "但见", "但觉",
  "如果", "如同", "如此", "如今",
  "因为", "因此", "因而",
  "所以", "所有", "所谓",
  "什么", "甚麽",
  "这个", "这里", "这些", "这样", "这份", "这种",
  "一个", "一种", "一些", "一下", "一次", "一般", "一起", "一定", "一样",
  "没有", "没什么", "没什么",
  "自己", "自身", "自从",
  "他们", "她们", "它们", "他人",
  "我们", "我的", "我们的",
  "你们", "你的",
  "知道", "觉得", "感觉", "感到", "感受",
  "看到", "看来", "看见", "看上去",
  "听到", "听说", "听见",
  "想到", "想起", "想法",
  "出来", "出去", "过来", "过去", "起来", "上去", "下来", "下去",
  "开始", "继续", "结束", "发现", "发生", "发挥",
  "时间", "时候", "时刻", "期间",
  "地方", "地位", "地点",
  "东西", "事情", "事件", "事实",
  "问题", "情况", "状态", "样子",
  "声音", "声响", "气息",
  "眼睛", "目光", "眼神",
  "身体", "身材", "身躯", "身子",
  "心里", "心情", "心思", "心底", "心脏",
  "手上", "手里", "手指",
  "脸上", "脸色", "笑容",
  "力量", "力度", "力气",
  "世界", "世间", "世人",
  "人生", "人类", "人口",
  "工作", "工人", "工业",
  "生活", "生命", "生死",
  "公司", "公主", "公子",
  "学校", "学生", "学习",
  "大学", "大人", "大家", "大约",
  "小姐", "小伙", "小说",
  "先生", "先后", "先进",
  "女人", "女子", "女儿", "女孩",
  "男人", "男子", "男孩",
  "老婆", "老公", "老板", "老师", "老是",
  "朋友", "友情",
  "哥哥", "姐姐", "弟弟", "妹妹",
  "父亲", "母亲", "父母",
  "儿子", "孩子", "小孩",
  "电话", "电脑", "电视", "电影",
  "手机", "手表",
  "中国", "中间", "中心", "中午",
  "美国", "美好", "美丽",
  "日本", "日子", "日常",
  "北京", "北方",
  "上海", "上面", "上衣",
  "今天", "今年", "今晚",
  "明天", "明年", "明白",
  "昨天", "昨夜",
  "现在", "现代", "现实",
  "突然", "突击",
  "于是", "于是乎",
  "因为", "因而",
  "所以", "所有",
  "然后", "然而",
  "接着", "接触",
  "同时", "同样", "同意",
  "已经", "以经",
  "还是", "还有",
  "或者", "或是",
  "并且", "并不是",
  "虽然", "虽说",
  "但是", "但使",
  "可是", "可以", "可能", "可看",
  "应该", "应当",
  "当然", "当前",
  "其实", "其他", "其次",
  "突然", "特别", "特征",
  "非常", "非凡",
  "十分", "十足",
  "有些", "有点", "有的", "有人", "有时", "有效",
  "没有", "没人", "没事",
  "不是", "不必", "不妨",
  "不会", "不能", "不要",
  "为了", "为什么", "为何",
  "通过", "通常", "通知",
  "进行", "进步", "进入",
  "成为", "成绩", "成功", "成长",
  "出现", "出来", "出生",
  "发生", "发现", "发展", "发动",
  "表示", "表现", "表明",
  "认为", "认识", "认真",
  "需要", "要求", "要点",
  "影响", "影子",
  "关系", "关心", "关键",
  "重要", "重新", "重复",
  "主要", "主人", "主动",
  "基本", "基础", "基地",
  "直接", "一直", "一定", "一般", "一起",
  "比较", "比如", "比例",
  "最后", "最近", "最好", "最多", "最高",
  "首先", "首次",
  "其中", "其他", "其次",
  "部分", "部门",
  "方面", "方便", "方向",
  "不同", "不断", "不到", "不错",
  "一样", "一直", "一定", "一般",
  "许多", "许久",
  "各种", "各样", "各自",
  "这种", "这样", "这些", "这个",
  "那种", "那样", "那些", "那个",
  "怎样", "怎么", "如何",
  "多少", "多久", "多么",
  "几个", "几乎", "几乎",
  "一切", "一生", "一起",
  "全部", "全国", "全家",
  "半个", "半天",
  "千万", "千万",
  "马上", "马路",
  "立刻", "立即",
  "忽然", "忽略",
  "几乎", "几近",
  "似乎", "似的",
  "好像", "好的", "好处", "好像",
  "只是", "只有",
  "已经", "以经",
  "正在", "正常", "正确",
  "一直", "一定",
  "仍然", "仍旧",
  "忽然", "忽略",
  "究竟", "竞然",
  "难道", "难看",
  "居然", "居中",
  "竟然", "竟是",
  "几乎", "几何",
  "稍微", "稍稍",
  "十分", "十份",
  "非常", "非凡",
  "特别", "特色",
  "尤其", "优先",
  "更加", "更好",
  "越来越", "越是",
  "越发", "越加",
]);

/** Trailing chars that mean we glued a particle/verb onto a real name (李动的、李动也) */
const NAME_TRAIL_PARTICLE = new Set(
  "的了着过吗呢吧啊呀嘛也都不就还却又只看心想说在是有没有被把给与和".split(""),
);

/**
 * Given-name tails that almost never form real 姓+名 in novels
 * (filters 有一点/都已经/高跟鞋/阴之门 etc.)
 */
const BAD_GIVEN_2 = new Set([
  "一点", "一些", "一个", "一种", "一下", "一次", "一起", "一定", "一样", "一般",
  "已经", "以上", "以下", "以外", "以及", "以来", "以后",
  "可能", "可以", "可是", "可怕",
  "时候", "时间", "时代", "时刻",
  "方面", "方式", "方向", "方便",
  "什么", "甚么",
  "女人", "女子", "女孩", "女权",
  "男人", "男子", "男孩",
  "之门", "之中", "之上", "之下", "之外", "之间", "之后", "之前", "之一", "之极",
  "一看", "一眼", "一声", "一下",
  "下来", "下去", "上来", "上去", "起来", "出来", "出去", "过来", "过去",
  "没有", "没错", "没事", "没有",
  "不是", "不会", "不能", "不要", "不过",
  "那么", "那个", "那样", "那些", "那里", "那种",
  "这么", "这个", "这样", "这些", "这里", "这种",
  "如何", "如今", "如果", "如同",
  "丝丝", "弹力", "两边", "两旁",
  "房间", "屋子", "沙发", "空气", "边缘", "程度", "感觉", "声音",
  "身体", "身子", "身材", "心跳", "心里", "心底", "心情",
  "眼睛", "目光", "眼神", "泪水",
  "红唇", "嘴唇", "粉嫩", "丰满", "丰腴", "雪白", "修长",
  "高跟鞋", // won't match 2-char
  "时间", "时候",
  "强化", "相当", "相比", "相对", "相关",
  "任何", "任务", "任意",
  "能够", "能力", "能量", "能否",
  "都是", "都有", "都会", "都在", "都已", "都女",
  "却是", "却又", "却不", "却没", "却已", "却仿", "却依",
  "有一", "有可", "有了", "有多", "有丝", "有弹", "有什",
  "第一", "第二", "第三", "首次",
  "向下", "向上", "向前", "向后", "向两", "向左", "向右",
  "左一", "右一", "左右",
  "段时", "段时",
  "阴唇", "花唇", "花心", "白浆", "水光", "水声", "高潮", "充血", "双腿", "张开", "包裹",
  "曲线", "明显", "强烈", "简直", "毕竟", "曾经", "明白", "尤其",
  "沙发", "房间", "空气", "边缘",
  "叔叔", "伯伯", "阿姨", "大爷", "大姐", "大哥",
  "神大", "神集",
  "女王", "之体", "化系", "小嘴", "当于", "下一", "何人", "一右", "比于",
  "一时", "依旧", "么多", "间中", "不知", "丝毫", "两侧", "仿佛", "一双",
  "何一", "上一", "大褂", "机会", "间之", "多少", "伦断", "伦斯",
  "力系",
]);

/** Full names / fragments that are body/porn description noise in web novels */
const BAD_FULL_NAMES = new Set([
  "阴唇肉", "高跟鞋", "阴之门", "阳之极", "都女人", "有一点", "都已经",
  "任何事", "能看到", "相当的", "向下移", "有了一", "第一次", "相比之",
  "那么的", "沙发上", "房间里", "空气中", "富有弹", "有弹性", "向两边",
  "却没有", "却已经", "却仿佛", "却依然", "双修大", "强化级", "一段时间",
  "阴之体", "阳之体", "都女王", "强化系", "张小嘴", "相当于", "向下一",
  "任何人", "左一右", "相比于", "第一时", "却依旧", "那么多", "房间中",
  "却不知", "有丝毫", "向两侧", "都仿佛", "那一双", "任何一", "向上一",
  "有多少", "白大褂", "却丝毫", "却发现", "有机会", "房间之", "和雨棠",
  "都不知",
]);

/**
 * Chars that are surnames but also ultra-common function words.
 * Pure frequency hits starting with these are usually false positives.
 */
const FLIMSY_SURNAME = new Set(
  "和而于从对把被让给与跟在不也都不就还又很更最已正却那这有能任相第左右全常边简勾充张白常".split(""),
);

/** Longer markers first so "笑道" wins over bare "道". */
const SPEECH_VERBS = [
  "不以为然道", "不屑道", "淡然道", "淡淡道", "冷声道", "沉声道", "柔声道",
  "轻声道", "低声道", "冷笑道", "苦笑道", "干笑道", "嗤笑道", "嘀咕道",
  "说道", "问道", "笑道", "怒道", "喝道", "喊道", "答道", "回道", "叹道",
  "接话", "回答", "解释", "补充", "打断", "吩咐", "命令",
  "嘀咕", "嘟囔", "开口",
  "说", "道", "问", "喊", "叫", "答", "笑", "怒", "喝", "斥", "骂", "叹", "哼",
].join("|");

const ADDRESS_RE = new RegExp(
  `(?:叫|名叫|唤作|名为|叫做|称呼|人称|外号|绰号)[了着过]?(?:作|为|做)?[「『""]?([\\u4e00-\\u9fff]{2,4})[」』""]?`,
  "g",
);

/** Char that often ends a name mention (boundary after name) */
const AFTER_NAME_OK = new Set(
  (
    "的了着过吗呢吧啊呀嘛，。！？…、；：\"'」』》】）),.!?;: \n\r\t" +
    "说问笑道喊叫答回看想走站坐来去是也却又都就还把被让给与和跟对在从向"
  ).split(""),
);

/** Char that often precedes a name */
const BEFORE_NAME_OK = new Set(
  (
    "，。！？…、；：\"'「『《【（( \n\r\t" +
    "是与和跟对把被让给向在从被叫见找请让替为有无像像是"
  ).split(""),
);

type HitSource = "speech" | "address" | "freq";

interface Agg {
  count: number;
  speechHits: number;
  first: number;
  last: number;
  buckets: Set<number>;
  evidence: string[];
  sources: Set<HitSource>;
  /** Times the char after name looked like a real boundary */
  boundaryHits: number;
}

function isHan(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 0x4e00 && c <= 0x9fff;
}

function isPlausibleName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 4) return false;
  if (BLACKLIST.has(name) || BAD_FULL_NAMES.has(name)) return false;
  if (!/^[\u4e00-\u9fff]+$/.test(name)) return false;
  if (/^(.)\1+$/.test(name)) return false;
  if (/^[的了在是不上下中大小我你他她它]/.test(name)) return false;
  // Function-word-ish 2-grams
  if (name.length === 2 && /[的了着过吗呢吧]$/.test(name)) return false;
  // 姓 + bad given (有一点 / 都已经 / 阴之门)
  if (name.length === 3 && BAD_GIVEN_2.has(name.slice(1))) return false;
  if (name.length === 4 && BAD_GIVEN_2.has(name.slice(2))) return false;
  // Body/porn description fragments (not person names)
  if (/[唇浆穴茎]/.test(name)) return false;
  return true;
}

function surnameLenAt(text: string, i: number): 0 | 1 | 2 {
  if (i + 1 < text.length && SURNAME_2.has(text.slice(i, i + 2))) return 2;
  if (SURNAME_1.has(text[i])) return 1;
  return 0;
}

function hasSurname(name: string): boolean {
  if (name.length < 2) return false;
  if (SURNAME_2.has(name.slice(0, 2))) return true;
  if (SURNAME_1.has(name[0])) return true;
  return false;
}

/**
 * Nicknames / epithets that often lack a real surname (web-novel cast).
 * Used so speech/address/freq can keep 阿龙、黑仔、短发大叔、老吴 without 百家姓.
 */
function isLikelyNickname(name: string): boolean {
  if (!name || name.length < 2 || name.length > 4) return false;
  if (BLACKLIST.has(name)) return false;
  // 阿X / 阿XX
  if (name.startsWith("阿") && name.length >= 2) return true;
  // X仔 / XX仔
  if (name.endsWith("仔") && name.length >= 2) return true;
  // 老X / 老XX (老吴、老阿伯 — 老 is not always a surname)
  if (name.startsWith("老") && name.length >= 2) return true;
  // descriptive roles used as names
  if (/(大叔|老头|阿伯|阿姨|大哥|大姐|小哥|小姐姐)$/.test(name)) return true;
  // X哥 / X姐 when 2–3 chars (屿哥 often alias; 航仔 covered above)
  if (name.length <= 3 && /(哥|姐|嫂|叔|伯)$/.test(name)) return true;
  return false;
}

function lineAt(text: string, offset: number, radius = 40): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(text.length, offset + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function goodBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : " ";
  const after = end < text.length ? text[end] : " ";
  // Prefer: not mid-word glued to random Han on both sides without particle
  const beforeOk = !isHan(before) || BEFORE_NAME_OK.has(before);
  const afterOk = !isHan(after) || AFTER_NAME_OK.has(after);
  return beforeOk || afterOk;
}

/**
 * Scan full novel text for character name candidates.
 */
export function scanCharacterCandidates(
  text: string,
  options: ScanCandidatesOptions = {},
): CharacterCandidate[] {
  if (!text || text.length < 20) return [];

  const maxCandidates = options.maxCandidates ?? 120;
  const maxEvidence = options.maxEvidence ?? 4;
  const bucketSize = options.bucketSize ?? 20_000;
  const minCount =
    options.minCount ??
    (text.length > 500_000 ? 4 : text.length > 100_000 ? 3 : text.length > 30_000 ? 2 : 2);

  const map = new Map<string, Agg>();

  const ensure = (name: string): Agg => {
    let a = map.get(name);
    if (!a) {
      a = {
        count: 0,
        speechHits: 0,
        first: Number.MAX_SAFE_INTEGER,
        last: 0,
        buckets: new Set(),
        evidence: [],
        sources: new Set(),
        boundaryHits: 0,
      };
      map.set(name, a);
    }
    return a;
  };

  const touch = (
    name: string,
    offset: number,
    source: HitSource,
    evidence: string,
    boundary: boolean,
    /** Freq n-grams need surname; speech/address may be nicknames (阿龙/黑仔/短发大叔). */
    requireSurname = true,
  ) => {
    if (!isPlausibleName(name)) return;
    if (requireSurname && !hasSurname(name)) return;
    const a = ensure(name);
    a.count++;
    if (source === "speech") a.speechHits++;
    if (boundary) a.boundaryHits++;
    a.first = Math.min(a.first, offset);
    a.last = Math.max(a.last, offset);
    a.buckets.add(Math.floor(offset / bucketSize));
    a.sources.add(source);
    if (a.evidence.length < maxEvidence && !a.evidence.includes(evidence)) {
      a.evidence.push(evidence);
    }
  };

  // --- 1) PRIMARY: every position starting with a surname → 2–3 (or 4) char names ---
  // Overlapping scan — do NOT use non-overlapping {2,3} regex.
  const n = text.length;
  for (let i = 0; i < n - 1; i++) {
    const sLen = surnameLenAt(text, i);
    if (!sLen) continue;

    // given-name length 1–2 → total name length sLen+1 .. sLen+2 (usually 2–3, compound 3–4)
    for (let g = 1; g <= 2; g++) {
      const nameLen = sLen + g;
      if (i + nameLen > n) continue;
      const name = text.slice(i, i + nameLen);
      if (!isPlausibleName(name)) continue;

      // Skip if next char continues what looks like a longer surnamed phrase we also count
      // (still count 3-char even if 2-char prefix exists — both tallied; merge later)

      const boundary = goodBoundary(text, i, i + nameLen);
      // For pure frequency: require at least weak boundary OR we'll filter by ratio later
      touch(name, i, "freq", lineAt(text, i), boundary);
    }
  }

  // --- 2) Speech subjects (surnamed preferred; nicknames without surname OK) ---
  // Non-greedy {2,4}? so "老吴问道" → 老吴 + 问道 (not 老吴问 + 道)
  const speechRe = new RegExp(
    `([\\u4e00-\\u9fff]{2,4}?)(?:[」』"']?)(?:\\s*)(?:${SPEECH_VERBS})`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = speechRe.exec(text)) !== null) {
    const raw = m[1];
    // Prefer longest surnamed prefix 2–4
    let name: string | null = null;
    let needSurname = true;
    for (const len of [4, 3, 2] as const) {
      if (raw.length < len) continue;
      const sub = raw.slice(0, len);
      if (isPlausibleName(sub) && hasSurname(sub)) {
        name = sub;
        break;
      }
    }
    // Nickname speakers: 阿龙说 / 黑仔喊 / 短发大叔道 (no standard surname)
    if (!name && isPlausibleName(raw) && isLikelyNickname(raw)) {
      name = raw;
      needSurname = false;
    }
    if (!name) continue;
    touch(name, m.index, "speech", lineAt(text, m.index), true, needSurname);
  }

  // --- 3) Address patterns (incl. nicknames) ---
  ADDRESS_RE.lastIndex = 0;
  while ((m = ADDRESS_RE.exec(text)) !== null) {
    const name = m[1];
    if (!isPlausibleName(name)) continue;
    const needSurname = hasSurname(name) ? true : isLikelyNickname(name);
    if (!hasSurname(name) && !isLikelyNickname(name)) continue;
    touch(name, m.index, "address", lineAt(text, m.index), true, !hasSurname(name) ? false : true);
  }

  // --- 3b) Standalone nickname tokens (阿X / X仔 / 老X / *大叔) ---
  // Scan all nick cores; accept if left edge is non-Han or a soft lead-in (叫/个/任…).
  {
    const nickCore =
      "(?:阿[\\u4e00-\\u9fff]{1,2})|(?:[\\u4e00-\\u9fff]{1,2}仔)|(?:老[\\u4e00-\\u9fff]{1,2})|" +
      "(?:[\\u4e00-\\u9fff]{2,3}大叔)|(?:[\\u4e00-\\u9fff]{2,3}老头)|(?:[\\u4e00-\\u9fff]{2,3}阿伯)|" +
      "(?:[\\u4e00-\\u9fff]{1,2}哥)|(?:[\\u4e00-\\u9fff]{1,2}姐)";
    const nickLead = new Set(
      (
        "叫名是的个位副任处里中把被向对跟与和给在从到了着过才就又都也还把让" +
        "那这各每有无像见找请替为"
      ).split(""),
    );
    const nickRe = new RegExp(`(${nickCore})`, "g");
    while ((m = nickRe.exec(text)) !== null) {
      const name = m[1];
      if (!isPlausibleName(name) || !isLikelyNickname(name)) continue;
      const i = m.index;
      const before = i > 0 ? text[i - 1] : " ";
      if (isHan(before) && !nickLead.has(before)) continue;
      touch(name, i, "freq", lineAt(text, i), true, false);
    }
  }

  // --- Score + filter ---
  const out: CharacterCandidate[] = [];
  for (const [name, a] of Array.from(map.entries())) {
    if (a.count < minCount) continue;
    if (BLACKLIST.has(name)) continue;

    // 李动的 / 李动也 — glued particle, not a name
    if (name.length >= 3 && NAME_TRAIL_PARTICLE.has(name[name.length - 1])) continue;

    const boundaryRatio = a.boundaryHits / Math.max(a.count, 1);
    const span = a.buckets.size;
    const hasSpeech = a.speechHits > 0;
    const hasAddress = a.sources.has("address");

    // Mid-phrase random n-grams
    if (!hasSpeech && a.boundaryHits < 2 && boundaryRatio < 0.2) continue;
    if (!hasSpeech && span < 2 && a.count < minCount + 3) continue;

    // --- 2-char pure-freq is almost always vocabulary noise ---
    // Exception: nicknames 阿X / X仔 / 老X that are program-tagged
    if (name.length === 2 && !hasSpeech && !hasAddress) {
      if (!(isLikelyNickname(name) && a.count >= Math.max(minCount, 3))) {
        continue;
      }
    }

    // Flimsy "surnames" (却/有/都/那…): require speech/address or very strong name shape
    if (!hasSpeech && !hasAddress && FLIMSY_SURNAME.has(name[0])) {
      continue;
    }

    // 3–4 char pure-freq (narrative novels): need real support
    // Nicknames (*大叔 / 老阿伯) use a softer bar — they rarely head "X说"
    if (name.length >= 3 && !hasSpeech && !hasAddress) {
      if (isLikelyNickname(name)) {
        if (a.count < minCount) continue;
      } else {
        if (a.count < Math.max(minCount, text.length > 500_000 ? 8 : 4)) continue;
        if (span < 3 && a.count < 20) continue;
        if (boundaryRatio < 0.12 && a.boundaryHits < 5) continue;
      }
    }

    // Score: frequency + span matter; 3-char names get strong boost (CN full names)
    const baseFreq = Math.min(a.count, 300);
    const spanScore = span * 5;
    const speechScore = a.speechHits * 8;
    const addressScore = hasAddress ? 15 : 0;
    const boundaryScore = Math.min(a.boundaryHits, 60) * 0.8;
    const lengthBoost = name.length >= 3 ? 120 : hasSpeech ? 20 : -40;
    // Soft-penalize absurdly frequent 2-char (common words that slipped through)
    const commonWordPenalty =
      name.length === 2 && a.count > 150 && !hasSpeech ? -200 : 0;

    const score = Math.round(
      baseFreq * (name.length >= 3 ? 1.5 : 0.6) +
        spanScore +
        speechScore +
        addressScore +
        boundaryScore +
        lengthBoost +
        commonWordPenalty,
    );

    out.push({
      name,
      score,
      count: a.count,
      spanBuckets: span,
      firstOffset: a.first === Number.MAX_SAFE_INTEGER ? 0 : a.first,
      lastOffset: a.last,
      speechHits: a.speechHits,
      evidence: a.evidence,
      sources: Array.from(a.sources),
    });
  }

  out.sort((a, b) => b.score - a.score || b.count - a.count);

  // Drop 2-char prefix when a longer extension is well supported
  const byName = new Map(out.map((c) => [c.name, c]));
  const finalList = out.filter((c) => {
    if (c.name.length !== 2) return true;
    // any 3-char extension with decent count?
    for (const [otherName, other] of Array.from(byName.entries())) {
      if (otherName.length >= 3 && otherName.startsWith(c.name) && other.count >= Math.max(5, c.count * 0.15)) {
        // keep short only if it has way more support (nickname / surname-only rare)
        if (c.count > other.count * 3 && c.speechHits >= 3) return true;
        return false;
      }
    }
    return true;
  });

  // Drop "李动X" when 李动 is the real name (X = verb/particle/eye/body)
  const JUNK_THIRD =
    "心只看想站走笑说问知感来几深顿眼才身的了着过也都不就还却又一在是有没把被让给与和跟对上下中来去";
  const cleaned = finalList.filter((c) => {
    if (c.name.length !== 3) return true;
    const prefix2 = c.name.slice(0, 2);
    const head = byName.get(prefix2);
    if (!head) return true;
    if (head.count >= c.count * 1.5 && JUNK_THIRD.includes(c.name[2])) {
      return false;
    }
    return true;
  });

  cleaned.sort((a, b) => b.score - a.score || b.count - a.count);
  return cleaned.slice(0, maxCandidates);
}

/** Format candidates for LLM prompt injection */
export function formatCandidatesForPrompt(
  candidates: CharacterCandidate[],
  limit = 80,
): string {
  const top = candidates.slice(0, limit);
  if (!top.length) return "（程序未扫到明显人名候选）";
  return top
    .map((c, i) => {
      const ev = c.evidence[0] ? ` | 例：${c.evidence[0].slice(0, 50)}` : "";
      return `${i + 1}. ${c.name}（约${c.count}次，言说${c.speechHits}，跨段${c.spanBuckets}${ev}）`;
    })
    .join("\n");
}
