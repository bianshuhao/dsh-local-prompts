# 提示词 — DSH 插件

仓库：https://github.com/bianshuhao/dsh-local-prompts

[English](README.en.md)

在 DeepSeek Harness 的 Web 主面板中直接读写本地 Markdown 目录。目录即分类，文件即提示词。

## 安装

本插件是一个 DSH bundle。推荐通过 DSH 的插件管理器安装本目录/仓库；安装完成后必须重启 DeepSeek Harness（只刷新页面不会重新加载 Host 端 Node 模块）。

本地开发或手动安装：

1. 把 `dsplug` 放到本机
2. 在 DSH profile 中把它作为 bundle 加入（通过插件管理器，或 profile 的 `bundles`/`dependencies`）
3. 重启 DeepSeek Harness，在左侧打开「提示词」

包名：`@bianshuhao/dsh-local-prompts`。

## 启动

安装本插件后，Host 会启动一个仅绑定 `127.0.0.1:45127` 的本地文件 API；客户端面板通过该 API 读写 `DOCS_ROOT`。安装或更新后请重启 DeepSeek Harness（Host 端 Node 模块不会随页面刷新更新），再打开左侧的「提示词」。

默认目录：

```text
~/Documents/DSH Prompts
```

首次启动会自动创建。目录优先级：`LOCAL_DOCS_ROOT` 环境变量 > 插件目录下的 `local.config.json` > 默认目录。

`local.config.json` 示例：

```json
{
  "root": "/absolute/path/to/your/prompts"
}
```

这个文件已加入 `.gitignore`，不要提交到 GitHub。端口固定在 `45127`，客户端和 Host 共用这个端口。API 写请求会校验本机 Origin 与 JSON Content-Type，并拒绝符号链接路径。

## 功能

- 左侧目录来自本地文件夹；支持任意层级，多级目录显示为 `父 / 子`。
- 右侧提示词列表：搜索、排序、新建、复制全文、复制完整本地路径、编辑、删除。
- 独立编辑页面：标题、目录、原文本 / 富文本 / 预览三种模式；富文本支持标题、加粗、列表、引用、代码块、表格，并自动序列化为 Markdown；文件区可复制完整本地路径。
- 编辑器左侧目录：自动从 Markdown 标题生成，支持层级折叠、点击跳转；默认收起，左侧小图标打开，整栏可随时收起（无设置按钮）。
- 富文本工具栏「引用」：搜索本地提示词和本地文件，插入相对路径的 Markdown 链接；也可「插入图片」，复制到根目录固定的 `assets/` 文件夹后自动插入并显示。
- 防抖自动保存：停止输入约 1.2 秒后自动写回 `.md`，新建文档也会自动创建；手动「保存」仍保留；失败时显示「自动保存失败」。
- 标题即文件名：保存时按标题重命名；切换目录会移动文件。
- 删除进入 `.trash/`，支持恢复、彻底删除和清空。
- SSE 自动同步；窗口重新获得焦点时也会刷新。
- 在任意对话里输入 `@`，会有一组「本地提示词」候选，支持输入名称边打边搜；选中后插入绝对路径 mention，模型可用 `read` 读取该提示词。
- 摘要从正文自动提取。

## 限制与安全

- 本地 API 只监听 `127.0.0.1:45127`，不对外网开放
- 端口固定；如果 `45127` 被占用，Host 会启动失败，需要先释放端口（当前版本不支持改端口）
- 本地 API 没有登录鉴权，只适合在可信的本机使用，不要把端口暴露到公网
- 通过 SSH 转发/远程浏览器打开的 DSH 页面访问不到运行 DSH 那台机器的 `127.0.0.1`
- 本地图片直接显示依赖本机资源接口 `127.0.0.1:45127`；把 Markdown 单独发给别人时图片不会自动跟过去
- 所有提示词、图片和回收站数据都在本地目录里，本插件不做云同步

## 结构

- `index.js` — Host 插件入口，启动本地 API。
- `server.js` — 本地文件 API + SSE。
- `src/client/` — 客户端面板源码。
- `client.js` — 构建后的 DSH Client 模块。
- `cordis.patch.yml` — Bundle 插件行。
- `locale/`、`docs/DETAIL.md`、`icon.svg` — 插件展示资源。

## 构建客户端

普通用户安装时不需要构建，仓库里的 `client.js` 已经是构建产物。

贡献者本地构建：

```bash
npm install
npm run typecheck
npm run build
```

构建脚本使用 `dsplug/node_modules` 里的 esbuild，不依赖外部的 `web/` 工程。
