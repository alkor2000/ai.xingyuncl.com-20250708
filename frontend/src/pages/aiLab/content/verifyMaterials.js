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

export const getVerifyMaterials = (language) => {
  const lang = String(language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return MATERIALS.map((m) => ({ id: m.id, ...m[lang] }))
}

export default MATERIALS
