/**
 * "AI 给出的校园资讯可信吗"（P7）示例材料：一份可信的原始通知 + 一份 AI 写的稿子（故意埋了错误与无法核实的说法）
 * 学生把稿子拆成一条条说法，逐条对照原始通知判断：证实 / 证伪 / 无法核实，再改写稿子。
 * 内容随界面语言切换（zh / en 各一份），埋错清单在改写之后才揭晓。
 */
const MATERIALS = [
  {
    id: 'sports-day',
    zh: {
      title: '秋季运动会',
      source: '【学校通知】关于举办第十二届秋季运动会的通知\n一、时间：10月17日（星期五）8:00–16:30；如遇雨天，顺延至10月24日（星期五）。\n二、地点：学校田径场。\n三、比赛项目：共12项，包括100米、200米、400米、800米、跳远、跳高、实心球、4×100米接力等。\n四、报名：各班在10月10日前报体育组；每班限报30人，每人限报2个项目。\n五、志愿者：面向八、九年级招募40名志愿者，负责检录与计时。\n六、联系人：体育组 张老师。',
      draft: '好消息！我校第十二届秋季运动会将于10月18日在田径场隆重举行，从早上8点一直进行到下午4点半。本届运动会共设17个比赛项目，包括100米、跳远、实心球和4×100米接力等。各班最多可报名25名运动员，每人限报2项，请在10月10日前向体育组报名。如果当天下雨，运动会将取消。学校还招募了40名志愿者协助检录与计时，有兴趣的同学可以联系体育组的张老师。另外，本届运动会将首次安排无人机航拍表演，请大家不要错过！',
      errors: ['日期写成 10月18日（通知是 10月17日）', '项目数写成 17 项（通知是 12 项）', '每班限报写成 25 人（通知是 30 人）', '雨天写成"取消"（通知是顺延到 10月24日）'],
      unverifiable: ['"首次安排无人机航拍表演"在通知里没有出现，无法核实']
    },
    en: {
      title: 'Autumn Sports Day',
      source: '[School notice] The 12th Autumn Sports Day\n1. Time: Friday 17 October, 8:00–16:30; in case of rain, postponed to Friday 24 October.\n2. Venue: the school athletics field.\n3. Events: 12 in total, including 100 m, 200 m, 400 m, 800 m, long jump, high jump, shot put and the 4×100 m relay.\n4. Registration: each class registers with the PE office by 10 October; at most 30 students per class, at most 2 events per student.\n5. Volunteers: 40 volunteers from grades 8 and 9 will handle check-in and timing.\n6. Contact: Mr Zhang, PE office.',
      draft: 'Great news! Our 12th Autumn Sports Day takes place on 18 October on the athletics field, from 8 in the morning until 4:30 in the afternoon. There are 17 events this year, including the 100 m, long jump, shot put and the 4×100 m relay. Each class may enter up to 25 athletes, two events each, and must register with the PE office by 10 October. If it rains on the day, the sports day will be cancelled. The school has also recruited 40 volunteers to help with check-in and timing; interested students can contact Mr Zhang in the PE office. And for the first time there will be a drone aerial show — do not miss it!',
      errors: ['Date given as 18 October (notice says 17 October)', '17 events (notice says 12)', '25 athletes per class (notice says 30)', 'Rain means "cancelled" (notice says postponed to 24 October)'],
      unverifiable: ['"A drone aerial show for the first time" does not appear in the notice and cannot be verified']
    }
  },
  {
    id: 'library',
    zh: {
      title: '图书馆开放安排',
      source: '【图书馆通知】新学期开放安排\n一、开放时间：周一至周五 8:00–20:30；周六 9:00–17:00；周日闭馆整理。\n二、借阅：每人最多同时借5本，借期30天，可续借1次。\n三、新书：本学期新到图书1,200册，已上架三楼新书区。\n四、自习室：三楼自习室共180个座位，需提前在校园网预约。\n五、图书馆成立于2009年，现有馆藏约6万册。',
      draft: '同学们注意啦！图书馆新学期开放时间为周一至周五早8点到晚8点半，周六上午9点到下午5点，周日也照常开放。每位同学最多可以同时借8本书，借期30天，还可以续借一次。本学期图书馆新进了2,000册新书，已经在三楼新书区上架。三楼自习室有180个座位，记得先在校园网上预约。我们的图书馆成立于2006年，馆藏约6万册，是全市中学里最大的图书馆。',
      errors: ['周日写成"照常开放"（通知是周日闭馆）', '借书上限写成 8 本（通知是 5 本）', '新书写成 2,000 册（通知是 1,200 册）', '成立年份写成 2006 年（通知是 2009 年）'],
      unverifiable: ['"全市中学里最大的图书馆"在通知里没有依据，无法核实']
    },
    en: {
      title: 'Library Opening Hours',
      source: '[Library notice] Opening arrangements for the new term\n1. Hours: Monday–Friday 8:00–20:30; Saturday 9:00–17:00; closed on Sunday.\n2. Borrowing: at most 5 books at a time, for 30 days, renewable once.\n3. New books: 1,200 new titles arrived this term and are on the third-floor new-arrivals shelves.\n4. Study room: the third-floor study room has 180 seats; book in advance on the campus network.\n5. The library was founded in 2009 and holds about 60,000 volumes.',
      draft: 'Attention everyone! This term the library is open Monday to Friday from 8 am to 8:30 pm, Saturday from 9 am to 5 pm, and also on Sundays as usual. Each student may borrow up to 8 books at a time for 30 days, renewable once. The library has added 2,000 new books this term, already shelved in the third-floor new-arrivals area. The third-floor study room has 180 seats — remember to reserve one on the campus network first. Founded in 2006 with about 60,000 volumes, our library is the largest secondary-school library in the city.',
      errors: ['"Also open on Sundays" (notice says closed on Sunday)', 'Borrowing limit of 8 books (notice says 5)', '2,000 new books (notice says 1,200)', 'Founded in 2006 (notice says 2009)'],
      unverifiable: ['"The largest secondary-school library in the city" has no basis in the notice and cannot be verified']
    }
  }
]

/* L5 "AI 讲的动物故事哪里不对"：AI 讲的动物小故事，每段预埋 1 处与图鉴不符的错误，低年级用绘本/图鉴核对 */
const ANIMAL_MATERIALS = [
  {
    id: 'penguin',
    zh: { title: '企鹅的一天', source: '【图鉴】企鹅是鸟类，有羽毛，不会飞；用翅膀在水里"飞"着游泳，最快每小时约 36 公里；帝企鹅可以潜到 500 米深；企鹅下蛋，帝企鹅爸爸在冬天用脚把蛋托在肚子下面孵化，大约 65 天；企鹅吃鱼、磷虾和乌贼；企鹅生活在南半球，南极、南非、澳大利亚等地都有。', draft: '企鹅是一种不会飞的鸟，浑身长着又密又短的羽毛。它们游泳的时候把翅膀当作船桨，一小时能游三十多公里。帝企鹅是潜水高手，能潜到五百米深的海里找鱼吃。到了冬天，企鹅妈妈把蛋放在脚上、盖在肚子下面，一动不动地站两个月把小企鹅孵出来。企鹅生活在南极和南半球的一些海岸边。', errors: ['孵蛋的是帝企鹅爸爸，不是妈妈'], unverifiable: [] },
    en: { title: "A Penguin's Day", source: '[Field guide] Penguins are birds with feathers that cannot fly; they "fly" underwater with their wings at up to about 36 km/h; emperor penguins can dive to 500 m; penguins lay eggs, and the emperor penguin father keeps the egg on his feet under his belly through the winter for about 65 days; penguins eat fish, krill and squid; they live in the Southern Hemisphere: Antarctica, South Africa, Australia and more.', draft: 'A penguin is a bird that cannot fly, covered in short dense feathers. When it swims it uses its wings like paddles and can move at over thirty kilometres an hour. Emperor penguins are expert divers and can go five hundred metres down to find fish. In winter the penguin mother keeps the egg on her feet under her belly and stands still for two months until the chick hatches. Penguins live along the coasts of Antarctica and other parts of the Southern Hemisphere.', errors: ['It is the emperor penguin father who incubates the egg, not the mother'], unverifiable: [] }
  },
  {
    id: 'bat',
    zh: { title: '蝙蝠不是鸟', source: '【图鉴】蝙蝠是唯一会真正飞行的哺乳动物；身上有毛，没有羽毛；胎生，用乳汁喂小蝙蝠；多数蝙蝠白天倒挂着休息，晚上出来活动；许多蝙蝠靠发出超声波并听回声来辨别方向和找虫子；蝙蝠有的吃虫子，有的吃水果、花蜜；蝙蝠一年通常只生一只幼崽。', draft: '蝙蝠会飞，但它不是鸟，而是哺乳动物，身上长的是毛不是羽毛。蝙蝠妈妈不下蛋，小蝙蝠是直接生出来的，靠喝妈妈的奶长大。蝙蝠白天倒挂在山洞里睡觉，天黑以后才出门。它们在黑暗里不靠眼睛，而是一边飞一边发出人耳听不到的声音，用回声找到虫子。蝙蝠妈妈一年能生五六只小蝙蝠。', errors: ['蝙蝠一年通常只生一只幼崽，不是五六只'], unverifiable: [] },
    en: { title: 'A Bat Is Not a Bird', source: '[Field guide] Bats are the only mammals that truly fly; they have fur, not feathers; they give birth to live young and feed them milk; most bats rest hanging upside down by day and are active at night; many bats find their way and their insects by sending out ultrasonic calls and listening for echoes; some eat insects, others fruit or nectar; a bat usually has one pup a year.', draft: 'Bats can fly, but they are not birds: they are mammals, with fur instead of feathers. A mother bat does not lay eggs; her pup is born alive and grows up drinking her milk. By day bats sleep hanging upside down in caves and only go out after dark. In the dark they do not rely on their eyes; as they fly they make sounds people cannot hear and use the echoes to find insects. A mother bat can have five or six pups a year.', errors: ['A bat usually has one pup a year, not five or six'], unverifiable: [] }
  },
  {
    id: 'frog',
    zh: { title: '青蛙的成长', source: '【图鉴】青蛙是两栖动物；把卵产在水里，卵孵出蝌蚪；蝌蚪用鳃呼吸、有尾巴、没有腿；蝌蚪先长出后腿，再长出前腿，尾巴慢慢缩短消失，变成小青蛙；成年青蛙用肺和皮肤呼吸，皮肤要保持湿润；青蛙吃虫子，用长长的舌头把虫子卷进嘴里；冬天青蛙会钻进泥里冬眠。', draft: '春天，青蛙妈妈把一团团卵产在池塘里。卵孵出来的是小蝌蚪，它们像小鱼一样用鳃呼吸，有一条长尾巴。慢慢地，蝌蚪先长出两条前腿，再长出后腿，尾巴越来越短，最后变成了小青蛙。长大的青蛙用肺和湿湿的皮肤呼吸，能用长舌头一下卷住飞过的虫子。到了冬天，青蛙会钻进泥里睡一整个冬天。', errors: ['蝌蚪先长后腿再长前腿，故事里说反了'], unverifiable: [] },
    en: { title: 'How a Frog Grows Up', source: '[Field guide] Frogs are amphibians; they lay eggs in water and the eggs hatch into tadpoles; tadpoles breathe with gills, have tails and no legs; the back legs grow first, then the front legs, and the tail shrinks away to leave a froglet; adult frogs breathe with lungs and through moist skin; frogs eat insects, catching them with a long tongue; in winter frogs burrow into mud to hibernate.', draft: 'In spring the mother frog lays clumps of eggs in the pond. The eggs hatch into tadpoles, which breathe with gills like little fish and have long tails. Slowly the tadpole grows its two front legs first, then its back legs, and its tail gets shorter and shorter until it becomes a froglet. A grown frog breathes with its lungs and its moist skin, and can flick out its long tongue to catch a passing insect. In winter frogs burrow into the mud and sleep the whole season.', errors: ['Tadpoles grow their back legs first, then the front legs; the story has it backwards'], unverifiable: [] }
  }
]

const SETS = { campus: MATERIALS, animal: ANIMAL_MATERIALS }

export const getVerifyMaterials = (language, set = 'campus') => {
  const lang = String(language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return (SETS[set] || MATERIALS).map((m) => ({ id: m.id, ...m[lang] }))
}

export default MATERIALS
