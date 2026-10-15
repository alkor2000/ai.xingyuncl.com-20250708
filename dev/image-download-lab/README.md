# 图片下载链隔离实验（反馈 eebafb84，2026-10-15）

目的：在真实 Chromium 里核实"点下载按钮"到底发生了什么——是否产生下载事件、文件名与字节、是否整页跳转、是否开新标签、页面有没有报错——而不是猜。
只连本机回环的两个实验源（不同端口 = 不同 origin），不碰生产、不碰任何真实用户图片、不调用付费生成。

文件：`server.py`（两个回环源：A 页面源 + 同源图片端点；B 跨源图片端点，含有/无 CORS、403、404；可选 `--tls` 自签 https 与混合内容场景）、
`antd-stub.js`（打包时替换 antd，只记录 message 调用）、`build-helpers.sh`（用仓库自带 esbuild 把 `imageHelpers.js` 打成页面可加载的 IIFE）、
`browser-check.cjs`（Playwright 矩阵：每个场景真点一次按钮，记录下载事件 / 导航 / 弹窗 / 报错 / 返回值）。

```bash
# 1 打包被测 helper（old = 当前树的 imageHelpers.js；在父版树上跑一次得到修复前的对照）
dev/image-download-lab/build-helpers.sh <源码树根> /tmp/lab/helpers new
# 2 起两个回环源
python3 dev/image-download-lab/server.py --role a --port 4411 --helpers /tmp/lab/helpers --cross http://127.0.0.1:4412 &
python3 dev/image-download-lab/server.py --role b --port 4412 &
# 3 跑矩阵（Playwright 在容器里；浏览器与 node_modules 见 README 顶部的 docker run 口径，宿主不用装系统库）
node dev/image-download-lab/browser-check.cjs --base http://127.0.0.1:4411 --helper new --out /tmp/lab/matrix-new.json
```

读法：`download` 非空 = 浏览器真的产生了下载事件（`failure` 非空表示浏览器随后取消了它，例如 404）；`navigatedAway` = 当前页面被替换成了图片地址；
`popup` = 开了新标签；`returned` = `downloadImage` 的返回值。`--tls` 自签证书下 Chromium 会取消来自该源的下载，所以 https 场景只用来看"是否跳转"，不能用来断言下载成功。
