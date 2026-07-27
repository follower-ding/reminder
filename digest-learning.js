/**
 * 每日编程知识：结构化课程库 + 飞书可读模板
 * 模板字段：课题 / 一句话 / 是什么 / 为什么 / 例子 / 动手 / 自检 / 延伸
 */

const LESSON_BANK = [
  {
    id: 'js-closure',
    topic: 'JavaScript 闭包',
    tags: ['JavaScript', '基础'],
    one_liner: '函数能「记住」定义时所在作用域里的变量，这就是闭包。',
    what: '当内部函数引用了外部函数的变量，即使外部函数已经执行完，那些变量仍可被访问。闭包 = 函数 + 它引用的外层环境。',
    why: '回调、事件、工厂函数、模块私有状态都靠它。搞不清闭包，就难理解「为什么循环里点按钮总是最后一个」。',
    example: 'function makeCounter() {\n  let n = 0;\n  return () => ++n;\n}\nconst c = makeCounter();\nc(); // 1\nc(); // 2',
    practice: [
      '手写 makeCounter，连续调用 3 次，写出每次返回值',
      '把 for 循环里用 var + 异步打印 i 的坑复现一次，再用 let 对比'
    ],
    check: [
      '闭包持有的是引用，不是拷贝一份值',
      '长期挂着的闭包可能让变量无法释放，注意内存'
    ],
    further: '可搜：MDN Closures'
  },
  {
    id: 'js-event-loop',
    topic: '事件循环（Event Loop）',
    tags: ['JavaScript', '异步'],
    one_liner: 'JS 单线程靠事件循环调度宏任务与微任务，决定代码谁先跑。',
    what: '调用栈执行同步代码；微任务（Promise.then / queueMicrotask）在当前宏任务结束后清空；然后才取下一个宏任务（setTimeout、I/O）。',
    why: '搞懂顺序，才知道为什么 setTimeout(0) 也不一定立刻执行，以及 await 后面的代码何时继续。',
    example: 'console.log(1);\nsetTimeout(() => console.log(2), 0);\nPromise.resolve().then(() => console.log(3));\nconsole.log(4);\n// 输出：1 4 3 2',
    practice: [
      '不看答案，默写上面例子的输出顺序',
      '再加一个 await Promise.resolve() 后的 console.log，预测顺序'
    ],
    check: [
      '微任务优先于下一个宏任务',
      'async 函数在 await 处暂停，后续进入微任务队列'
    ],
    further: '可搜：WHATWG event loop / Jake Archibald'
  },
  {
    id: 'http-status',
    topic: 'HTTP 状态码速记',
    tags: ['HTTP', '后端'],
    one_liner: '2xx 成功、3xx 跳转、4xx 客户端错、5xx 服务端错——先看首位数字。',
    what: '200 OK；201 Created；204 No Content；301/302 重定向；400 坏请求；401 未认证；403 无权限；404 不存在；429 限流；500/502/503 服务端问题。',
    why: '联调与排查时，状态码比「报错了」信息量大十倍；写 API 时选对码也是契约的一部分。',
    example: 'GET /api/user/1 → 200 + JSON\nPOST /api/user → 201 + Location\nGET /api/secret → 401（没带 Token）\nGET /api/admin → 403（有 Token 但权限不够）',
    practice: [
      '区分 401 与 403：各举一个真实接口场景',
      '列出你会在自己项目里用到的 5 个状态码及含义'
    ],
    check: [
      '401 = 你是谁未知；403 = 知道你是谁但不让做',
      '502 常是网关后面的上游挂了，不一定是你业务代码抛错'
    ],
    further: '可搜：HTTP status code MDN'
  },
  {
    id: 'git-rebase',
    topic: 'Git：merge vs rebase',
    tags: ['Git', '协作'],
    one_liner: 'merge 保留分叉历史；rebase 把你的提交「挪」到目标分支尖上，历史更直。',
    what: 'merge 产生合并提交，安全、可追溯。rebase 重写提交父节点，线性好看，但已推送的公共分支慎用。',
    why: 'Code Review 与排查回归时，干净历史省大量时间；搞错 rebase 也可能改写他人历史，引发冲突风暴。',
    example: '# 在 feature 上把最新 main 接进来（线性）\ngit fetch origin\ngit rebase origin/main\n# 冲突解决后\ngit add .\ngit rebase --continue',
    practice: [
      '在练习仓库建两条分支，分别用 merge 与 rebase 合一次，对比 git log --oneline --graph',
      '记住金句：已推到共享分支的提交，不要强制 rebase'
    ],
    check: [
      'rebase 会改写 commit hash',
      '公共分支优先 merge；个人 feature 可用 rebase'
    ],
    further: '可搜：Pro Git Branching Rebasing'
  },
  {
    id: 'sql-index',
    topic: 'SQL 索引在干什么',
    tags: ['SQL', '数据库'],
    one_liner: '索引像书的目录：用额外空间换查询速度，但会拖慢写入。',
    what: '常见 B-Tree 索引按列排序存储指针。WHERE / JOIN / ORDER BY 用到的列更值得建索引；高选择性列效果更好。',
    why: '慢查询九成与缺索引或索引失效有关。盲目建太多索引会让 INSERT/UPDATE 变慢。',
    example: '-- 常按 user_id 查订单\nCREATE INDEX idx_orders_user ON orders(user_id);\nSELECT * FROM orders WHERE user_id = 42;',
    practice: [
      '想一条你项目里最常用的查询，写出可能的索引列',
      '解释：在低区分度列（如性别）上单独建索引为何收益差'
    ],
    check: [
      '索引不是越多越好',
      '对表达式/函数包裹的列，普通索引可能用不上'
    ],
    further: '可搜：Use The Index, Luke'
  },
  {
    id: 'rest-idempotent',
    topic: '接口幂等性',
    tags: ['API', '后端'],
    one_liner: '同一请求做多次，效果与做一次相同——这叫幂等。',
    what: 'GET/PUT/DELETE 通常设计为幂等；POST 默认不幂等（可能重复建单）。可用幂等键（Idempotency-Key）让「创建类 POST」可安全重试。',
    why: '网络会超时重试。没有幂等，用户狂点或网关重放就会重复扣款、重复下单。',
    example: 'POST /orders\nIdempotency-Key: 8f3c-...\n# 第一次：创建订单 200\n# 第二次同 Key：返回同一订单，不新建',
    practice: [
      '给「创建订单」设计一个幂等键放哪（Header 还是 Body）并说明原因',
      '说明为何「查询余额」天然更接近幂等'
    ],
    check: [
      '幂等 ≠ 没有副作用，而是重复执行结果一致',
      '超时重试前先想清接口是否幂等'
    ],
    further: '可搜：Stripe Idempotent requests'
  },
  {
    id: 'ts-unknown',
    topic: 'TypeScript：any vs unknown',
    tags: ['TypeScript', '类型'],
    one_liner: 'any 关掉检查；unknown 强制你先收窄类型再使用。',
    what: 'any 可赋给任何变量、可任意点属性。unknown 必须 typeof / 类型守卫 / 断言后才能当具体类型用。',
    why: '对接外部 JSON、API 时用 unknown 更安全，把「我不确定」显式表达出来，而不是用 any 埋雷。',
    example: 'function handle(data: unknown) {\n  if (typeof data === "string") {\n    console.log(data.toUpperCase());\n  }\n}',
    practice: [
      '把一个 any 参数改成 unknown，补上类型守卫直到能编译',
      '列出 2 个你会坚持用 unknown 的场景'
    ],
    check: [
      'unknown 更安全；any 是逃生舱，不是默认选项',
      '类型断言 as 不会运行时校验'
    ],
    further: '可搜：TypeScript Handbook unknown'
  },
  {
    id: 'css-specificity',
    topic: 'CSS 优先级（Specificity）',
    tags: ['CSS', '前端'],
    one_liner: '谁更「具体」谁赢：行内 > ID > class/属性/伪类 > 标签/伪元素。',
    what: '比较选择器权重，不是「写在后面一定赢」（同权重才看源码顺序）。!important 能压过常规规则，但会让维护变难。',
    why: '样式「改不动」多半是优先级大战。理解权重，才能少写 !important、少叠层。',
    example: '/* 0,1,0 */ .btn { color: blue }\n/* 0,2,0 */ .card .btn { color: red }\n/* 红胜出 */',
    practice: [
      '给同一按钮写三条选择器，标出权重并预测最终颜色',
      '试着不用 !important 覆盖一个组件库按钮颜色'
    ],
    check: [
      'ID 权重大于 class',
      '同样权重时，后写的覆盖先写的'
    ],
    further: '可搜：CSS Specificity MDN'
  },
  {
    id: 'async-await-err',
    topic: 'async/await 错误处理',
    tags: ['JavaScript', '异步'],
    one_liner: 'await 的 Promise 若 reject，要用 try/catch（或 .catch）接住。',
    what: 'async 函数里 await 失败会抛异常。外层没有 catch 就会变成未处理的 Promise rejection。',
    why: '线上「偶发失败」常见于网络错误没接住，页面静默坏掉或进程告警。',
    example: 'async function load() {\n  try {\n    const res = await fetch("/api");\n    if (!res.ok) throw new Error(res.status);\n    return await res.json();\n  } catch (e) {\n    console.error("load failed", e);\n    return null;\n  }\n}',
    practice: [
      '给一个 await fetch 补上 try/catch，并区分网络错误与 HTTP 4xx/5xx',
      '用 Promise.allSettled 处理多个并行请求，打印每个结果状态'
    ],
    check: [
      '忘记 await 时，错误可能不会按你想的路径抛出',
      'finally 适合做 loading 关闭等收尾'
    ],
    further: '可搜：MDN async function'
  },
  {
    id: 'big-o',
    topic: '时间复杂度直觉（Big-O）',
    tags: ['算法', '基础'],
    one_liner: '看数据量变大时，步骤数涨多快：O(1)、O(n)、O(n log n)、O(n²)。',
    what: 'O(1) 哈希取值；O(n) 扫一遍；O(n log n) 常见排序；O(n²) 双层循环。只关心增长趋势，忽略常数。',
    why: '面试与性能优化的共同语言。能判断「这代码数据大十倍会慢多少」。',
    example: '// O(n)\nfor (const x of arr) console.log(x);\n// O(n²)\nfor (const a of arr)\n  for (const b of arr) ...',
    practice: [
      '判断：在数组里找最大值；嵌套双重循环找所有数对——各是什么复杂度',
      '说明为何有时 O(n log n) 的算法实际比「看起来简单」的 O(n²) 更快'
    ],
    check: [
      'Big-O 描述增长，不是绝对毫秒数',
      '输入规模够大时，复杂度差异会被放大'
    ],
    further: '可搜：Big-O Cheat Sheet'
  },
  {
    id: 'json-schema-mind',
    topic: '先定数据契约再写代码',
    tags: ['工程', 'API'],
    one_liner: '前后端先对齐「字段长什么样」，比先写页面更省返工。',
    what: '用一份轻量约定描述：字段名、类型、必填、枚举、错误码。可以是 OpenAPI、TypeScript 类型或一张表。',
    why: '联调吵架多半是契约不清。契约稳定后，前端 mock、后端实现、测试用例都能并行。',
    example: '类型约定示例：\n{\n  "id": 1,\n  "title": "string",\n  "status": "todo|doing|done",\n  "due_at": "ISO8601|null"\n}',
    practice: [
      '给「待办事项」写 5 个字段的契约（含一个枚举）',
      '列出 2 个错误码（如 404 / 422）及前端应如何提示'
    ],
    check: [
      '可选字段与 null 要说清楚',
      '枚举变更属于破坏性变更，要通知调用方'
    ],
    further: '可搜：OpenAPI 3.0 overview'
  },
  {
    id: 'security-xss',
    topic: 'XSS：别把不可信 HTML 当自己人',
    tags: ['安全', '前端'],
    one_liner: '用户输入原样进 HTML，就可能变成可执行脚本——这是 XSS。',
    what: '反射型 / 存储型 / DOM 型。防御：默认文本插值转义；需要富文本则白名单消毒；关键 Cookie 用 HttpOnly。',
    why: '一条评论里的脚本就能偷登录态。前端框架默认转义，但 v-html / dangerouslySetInnerHTML / 拼字符串仍危险。',
    example: '// 危险\nel.innerHTML = userComment;\n// 更稳妥\nel.textContent = userComment;',
    practice: [
      '找出项目里一处渲染用户内容的代码，判断是否转义',
      '说明为何「只在前端过滤 script 标签」不够'
    ],
    check: [
      '信任边界：凡是外来的字符串都不可信',
      '修复应在输出编码 + 必要的 CSP，不只靠前端正则'
    ],
    further: '可搜：OWASP XSS'
  },
  {
    id: 'docker-image-layers',
    topic: 'Docker 镜像分层',
    tags: ['DevOps', '工程'],
    one_liner: '镜像由只读层叠起来；合理排序 Dockerfile 指令能吃到缓存、构建更快。',
    what: '每条 RUN/COPY 常产生新层。依赖安装放前面、源码 COPY 放后面，改代码时不必重装依赖。',
    why: 'CI 构建时间与镜像体积直接影响交付速度。懂分层就会写更友好的 Dockerfile。',
    example: 'COPY package.json package-lock.json ./\nRUN npm ci\nCOPY . .\nCMD ["node", "server.js"]',
    practice: [
      '解释：为什么先 COPY package.json 再 npm ci，而不是先 COPY 全部源码',
      '写出一条减小镜像体积的做法（如多阶段构建）'
    ],
    check: [
      '改后面的层不会自动让前面的层失效',
      '.dockerignore 能减少发送给 daemon 的上下文'
    ],
    further: '可搜：Docker multi-stage builds'
  },
  {
    id: 'regex-capture',
    topic: '正则：捕获组与非捕获组',
    tags: ['正则', '基础'],
    one_liner: '() 提取匹配；(?:) 只分组不捕获——少背「黑魔法」，先会拆组。',
    what: '用圆括号分组并提取子串；加 ?: 变成非捕获，只控制优先级/重复，不占「第 n 组」。',
    why: '解析日志、校验格式、改写 URL 时，正则是日常武器；捕获组用错会让替换结果错乱。',
    example: 'const m = "v1.2.3".match(/^v(\\d+)\\.(\\d+)\\.(\\d+)$/);\n// m[1]=1, m[2]=2, m[3]=3',
    practice: [
      '写正则提取邮箱 @ 前的本地部分（不必完美，能跑即可）',
      '把一个用了捕获组的正则改成非捕获，观察 match 结果差异'
    ],
    check: [
      '贪婪与非贪婪（.* vs .*?）会影响匹配范围',
      '复杂正则要配测试用例，别只靠「感觉对」'
    ],
    further: '可搜：regex101'
  }
];

function dayIndex(dateKey) {
  const s = String(dateKey || '').slice(0, 10);
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return new Date().getDate() % LESSON_BANK.length;
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  const day = Math.floor(diff / 86400000);
  return Math.abs(day) % LESSON_BANK.length;
}

const TOPIC_ALIASES = {
  前端: ['JavaScript', 'TypeScript', 'CSS', '前端', '安全'],
  后端: ['HTTP', 'API', 'SQL', '后端', '安全'],
  算法: ['算法', '基础'],
  工程: ['工程', 'Git', 'DevOps', 'API'],
  Git: ['Git'],
  JavaScript: ['JavaScript', '异步', '基础'],
  TypeScript: ['TypeScript'],
  英语: ['JavaScript', 'HTTP', '算法'],
  写作: ['工程', 'API']
};

function lessonMatchesTopic(lesson, topic) {
  const t = String(topic || '').trim();
  if (!t) return false;
  if (lesson.topic.includes(t) || lesson.tags.some((tag) => tag.includes(t) || t.includes(tag))) return true;
  const aliases = TOPIC_ALIASES[t] || [];
  return aliases.some((a) => lesson.tags.some((tag) => tag.includes(a) || a.includes(tag)) || lesson.topic.includes(a));
}

function pickLesson(dateKey, topics) {
  const idx = dayIndex(dateKey);
  const pool = Array.isArray(topics) && topics.length
    ? LESSON_BANK.filter((l) => topics.some((t) => lessonMatchesTopic(l, t)))
    : LESSON_BANK;
  const list = pool.length ? pool : LESSON_BANK;
  return list[idx % list.length];
}

/** 飞书 lark_md 友好：少用围栏代码块，改用缩进/行内 */
function formatLessonMarkdown(lesson, dateLabel) {
  const example = String(lesson.example || '')
    .split('\n')
    .map((line) => (line.trim() ? ` ${line}` : ''))
    .join('\n');
  const practice = (lesson.practice || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
  const check = (lesson.check || []).map((c) => `• ${c}`).join('\n');
  const tags = (lesson.tags || []).join(' · ');

  return [
    `📚 **今日课题** · ${lesson.topic}`,
    tags ? `标签：${tags}` : null,
    dateLabel ? `日期：${dateLabel}` : null,
    '',
    '**一句话**',
    lesson.one_liner,
    '',
    '**是什么**',
    lesson.what,
    '',
    '**为什么重要**',
    lesson.why,
    '',
    example ? '**小例子**' : null,
    example || null,
    '',
    '**动手 5～10 分钟**',
    practice,
    '',
    '**自检**',
    check,
    lesson.further ? `\n**延伸**\n${lesson.further}` : null,
    '',
    '——',
    '读完可在飞书回「收到」；想换主题可在订阅里改学习关键词。'
  ].filter((x) => x != null && x !== '').join('\n');
}

async function enrichLessonWithAI(lesson) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return lesson;
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.5,
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content:
              '你是编程教练。基于给定课题，输出更清晰的中文讲解 JSON，字段：one_liner, what, why, example, practice(数组2条), check(数组2条), further。example 为短代码（<=8行）。不要 markdown，只 JSON。'
          },
          {
            role: 'user',
            content: JSON.stringify({
              topic: lesson.topic,
              tags: lesson.tags,
              seed: {
                one_liner: lesson.one_liner,
                what: lesson.what,
                why: lesson.why
              }
            })
          }
        ]
      })
    });
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim() || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return lesson;
    const parsed = JSON.parse(match[0]);
    return {
      ...lesson,
      one_liner: String(parsed.one_liner || lesson.one_liner).slice(0, 80),
      what: String(parsed.what || lesson.what).slice(0, 280),
      why: String(parsed.why || lesson.why).slice(0, 280),
      example: String(parsed.example || lesson.example).slice(0, 500),
      practice: Array.isArray(parsed.practice) && parsed.practice.length
        ? parsed.practice.map((x) => String(x).slice(0, 80)).slice(0, 3)
        : lesson.practice,
      check: Array.isArray(parsed.check) && parsed.check.length
        ? parsed.check.map((x) => String(x).slice(0, 80)).slice(0, 3)
        : lesson.check,
      further: String(parsed.further || lesson.further || '').slice(0, 80)
    };
  } catch {
    return lesson;
  }
}

function formatLessonShort(lesson, dateLabel) {
  return [
    `📚 **今日课题** · ${lesson.topic}`,
    dateLabel ? `日期：${dateLabel}` : null,
    '',
    lesson.one_liner,
    '',
    '📄 详细讲解（是什么 / 例子 / 练习）已写入飞书文档。',
    '点下方 **阅读全文** 打开文档，不跳转网页。'
  ].filter(Boolean).join('\n');
}

async function buildDailyProgrammingLesson({ dateKey, topics, useAI }) {
  let lesson = pickLesson(dateKey, topics);
  if (useAI) lesson = await enrichLessonWithAI(lesson);
  const markdown = formatLessonMarkdown(lesson, dateKey);
  const short = formatLessonShort(lesson, dateKey);
  return {
    lesson,
    item: {
      title: `今日课题 · ${lesson.topic}`,
      desc: lesson.one_liner,
      blurb: lesson.one_liner,
      meta: (lesson.tags || []).join(' · '),
      url: '',
      format: 'lesson',
      body: markdown
    },
    pushItem: {
      kind: 'digest',
      type: 'digest',
      source: 'learning',
      name: 'learning',
      format: 'lesson',
      message: short,
      fullMarkdown: markdown,
      shortMessage: short
    }
  };
}

module.exports = {
  LESSON_BANK,
  pickLesson,
  formatLessonMarkdown,
  formatLessonShort,
  enrichLessonWithAI,
  buildDailyProgrammingLesson
};
