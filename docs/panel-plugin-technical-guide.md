# MCSManager Panel 插件技术指南

## 1. 契约与信任模型

这是面向受信任、由管理员安装的 Panel 插件版本 1 契约。它只支持 Panel HTTP API、独立前端页面和仪表板卡片，不增加 Daemon API、Daemon 事件、核心页面注入、热重载或运行时安装。

每个插件包必须声明 `apiVersion: 1`，宿主拒绝加载不受支持的版本。插件服务端代码在 Panel 进程内执行，浏览器代码在 Panel 源下执行。它们是扩展能力，而不是沙箱或不受信任代码；只有信任包来源的管理员才能安装插件。

宿主隔离非法清单、注册错误、激活异常、客户端加载失败和释放异常。它无法隔离进程崩溃、同步死循环、未释放内存或永久挂起的同进程激活。强运行时隔离需要未来采用进程与 IPC 插件架构，不属于本契约范围。

## 2. 插件包结构

```text
plugins/
  packages/
    example-status/
      plugin.json
      server/
        index.cjs
      public/
        index.mjs
        assets/
        locales/
          en_us.json
  data/
    example-status/
```

`plugins/` 相对于 Panel 工作目录。宿主只扫描 `plugins/packages/` 下的直接插件包目录。`packages/<plugin-id>/` 是不可变的部署输入；`data/<plugin-id>/` 在成功激活后创建，用于保存可变状态。

插件包目录名必须与清单 ID 一致。插件 ID、页面 ID 和卡片 ID 使用 `^[a-z0-9][a-z0-9-]{0,62}$`，且在各自插件范围内唯一。每个清单路径都是包根目录内的相对 POSIX 风格路径。绝对路径、盘符前缀、空路径段、`.`、`..` 和符号链接都会被拒绝。激活或挂载静态资源前，宿主递归拒绝包内任何符号链接，并对每个被引用路径执行解析和 `realpath` 包含关系检查。

服务端依赖应打包进 CommonJS 入口，或使用插件包内正常的 Node 依赖解析。不得依赖 Panel 私有依赖或源码别名。浏览器入口及其所有导入必须是插件 `public/` 下可由浏览器解析的静态 URL；不支持裸模块说明符或 `@/` 导入。

## 3. 清单

```json
{
  "apiVersion": 1,
  "id": "example-status",
  "version": "1.0.0",
  "enabled": true,
  "server": { "entry": "server/index.cjs" },
  "client": {
    "entry": "index.mjs",
    "locales": {
      "en_us": "locales/en_us.json",
      "zh_cn": "locales/zh_cn.json"
    }
  },
  "pages": [
    {
      "id": "status",
      "titleKey": "plugin.example-status.page.status.title",
      "permission": 10,
      "mainMenu": true
    }
  ],
  "cards": [
    {
      "id": "summary",
      "titleKey": "plugin.example-status.card.summary.title",
      "descriptionKey": "plugin.example-status.card.summary.description",
      "permission": 10,
      "width": 4,
      "height": "200px",
      "category": "DATA"
    }
  ]
}
```

`server` 为可选项。当 `pages` 或 `cards` 非空时，`client` 为必填项；首版的所有前端贡献项共用同一个入口。`enabled: false` 表示跳过激活，直到下一次重启。

宿主生成所有公开标识符并拒绝冲突：

| 贡献项 | 宿主生成值 |
| --- | --- |
| API 根路径 | `/api/plugins/<plugin-id>` |
| 静态根路径 | `/plugins/<plugin-id>/` |
| 页面路径 | `/plugins/<plugin-id>/<page-id>` |
| 页面名称 | `plugin:<plugin-id>:page:<page-id>` |
| 卡片类型 | `plugin:<plugin-id>:card:<card-id>` |

`permission` 只能使用现有角色等级：访客 `0`、用户 `1` 或管理员 `10`。卡片 `width` 必须是 `1` 至 `12` 的整数；`height` 只能使用现有布局高度值（`100px`、`200px`、`400px`、`600px`、`800px` 或 `unset`）；`category` 必须是现有 `NEW_CARD_TYPE` 值。首版页面始终为顶级路由。

## 4. 服务端入口与 API 鉴权

可选 CommonJS 入口导出 `activate(context)`。它可以同步或异步，并返回可选的 `dispose()` 函数或对象。公开宿主上下文只包含 `id`、`version`、`dataDir`、`logger`、`ROLE` 和受限的 `http` 门面。契约不包含 Koa 应用、任意路由、Panel 服务、Daemon 客户端或不受限制的文件系统帮助器；但受信任的同进程代码仍不是沙箱。

```js
module.exports.activate = function activate(context) {
  context.http.get({ path: "/status", permission: context.ROLE.ADMIN }, async (ctx) => {
    ctx.body = { ready: true };
  });

  context.logger.info("Example status plugin activated");
  return {
    dispose() {
      context.logger.info("Example status plugin disposed");
    }
  };
};
```

`http.get`、`post`、`put` 和 `delete` 都接收一个包含相对 `path` 与合法 `permission` 的选项对象，以及一个处理器。门面拒绝重复的方法和路径、非法路径及激活完成后的注册。它会预置宿主现有的 `permission({ level })` 中间件，处理器无法意外公开，也无法绕过 Panel 的令牌、AJAX 或会话检查。插件处理器仍必须校验所有请求值，尤其是路径、ID、文件名、命令参数、URL 和容器参数。

使用宿主日志器。可变文件只能存储在 `dataDir` 下。定时器、订阅、流、Socket、子进程和其他长生命周期资源都必须在 `dispose()` 中释放。

## 5. 静态资源与缓存

只有 `public/` 会挂载到 `/plugins/<plugin-id>/`。宿主绝不服务 `plugin.json`、`server/`、`data/`、包元数据或经链接可达的任意文件。客户端入口位于 `/plugins/<plugin-id>/<client.entry>`，语言资源路径相对于 `public/`。

将 `public/` 下所有文件视为公开内容。不要存放凭据、报告、用户内容、生成数据或服务端源码。客户端分块使用稳定的相对 URL。宿主为清单引用的客户端入口和语言 JSON 设置 `Cache-Control: no-cache`；内容哈希后的不可变资源可以长期缓存。这样可防止替换插件包后继续使用旧入口模块。

## 6. 前端模块契约

宿主只会在核心 i18n 初始化完成且描述符端点已按登录用户过滤贡献项后加载模块。它为页面或卡片调用 `mount(element, context)`，并会在替换贡献项、离开路由或卸载卡片前调用返回的清理函数。

```js
export function mount(element, context) {
  element.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = context.t(context.contribution.titleKey);
  element.appendChild(title);

  return () => element.replaceChildren();
}
```

`context` 提供 `pluginId`、`contribution`、`route`、`card`、`locale`、`theme`、`t(key, params)` 和 `request(options)`。`request()` 是调用插件自身 API 的唯一受支持帮助器；它遵循 Panel 前端请求约定，包括会话令牌和 `X-Requested-With` 请求头。它只接受相对 API 路径，并将其解析到 `/api/plugins/<plugin-id>` 之下。

插件 UI 文本使用其声明的 i18n key。包含前端贡献项的插件必须提供 `en_us`；缺少当前语言时回退到 `en_us`。语言 JSON 将 key 映射为字符串，不能覆盖任何现有核心 key 或其他插件 key。宿主拒绝同一插件不同语言资源中声明重复 key 的包。

模块不得导入私有 Panel 模块、Pinia store、核心 Vue 组件或别名。插件可以打包 Vue 并在 `element` 内挂载自己的 Vue 应用，但必须自行清理，且不得修改该元素外的宿主 DOM。浏览器代码仍属于受信任代码，不能被当作安全边界。

## 7. 渲染与布局行为

宿主 Vue `PluginOutlet` 是实际注册到 Vue Router 和 `LAYOUT_CARD_TYPES` 的组件。它从宿主注册表解析贡献项，校验可用性与当前角色，再加载浏览器模块。描述符缺失、模块异常、导出无效或清理失败时，均显示现有宿主错误或不可用状态。

已保存布局项保持正常的 `ILayoutCard` 结构。唯一插件专属的持久化值是清单表格中定义的稳定 `type`。移除、禁用、升级或插件失败均不重写布局。不可用类型显示为不可用卡片；相同插件 ID 和卡片 ID 再次可用后即可恢复渲染。

宿主控制布局变更。现有布局编辑仍遵守当前权限，插件元数据不会授予用户添加、保存、删除或修改布局的能力。即使页面或卡片被隐藏，API 权限仍是强制要求。

## 8. 运维与验证

新增、移除、启用、禁用或替换插件包均需要重启 Panel。替换前备份 `plugins/data/<plugin-id>/`。启动日志记录插件 ID、版本、生命周期阶段和已净化的失败原因；普通描述符响应中不得暴露服务端路径、堆栈或数据。

插件作者必须测试：

- 管理员和低角色用户的描述符与 API 访问；
- 非法清单 ID、重复贡献项、路径穿越和符号链接；
- 服务端激活和释放失败；
- 缺少语言文件和浏览器模块失败；
- 已保存卡片的移除与恢复；
- 所有定时器、监听器、流、Socket 和子进程的清理。

宿主变更必须为清单和路径校验、路由门面鉴权、描述符过滤、生命周期释放顺序、静态包含关系、注册表行为和不可用卡片渲染增加聚焦测试。交付前在 `panel` 运行 `npm run build`，在 `frontend` 运行 `npm run type-check`，并执行相关测试。
