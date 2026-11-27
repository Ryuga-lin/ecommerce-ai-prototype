# 电商素材工作台 · AI 原型

一个按 DataWhale Easy-Vibe 教程（第一章「从方案到作品」）搭建的可交互 Web 原型。
前端为单文件零依赖页面，文案由 DeepSeek 实时生成，API Key 只保留在服务端。

## 功能

- 填写商品名称、类目、品牌、材质、适用人群，点击「生成草稿」
- 调用 DeepSeek 生成商品标题、简介与三条卖点，结果可直接编辑、复制
- 载入示例数据快速复现流程
- 错误提示与重试；模板库、素材库、Excel 导入等模块预留入口

## 目录

| 文件 | 说明 |
|---|---|
| `index.html` | 前端页面（内联 CSS / JS，零依赖） |
| `server.js` | Node 服务端：静态托管 + `/api/generate` 代理调用 DeepSeek |
| `.env.example` | 配置模板（占位符，需复制为 `.env.local` 并填入自己的 Key） |
| `1-配置Key.bat` | Windows 一键生成配置文件 |
| `2-启动服务.bat` | Windows 一键启动服务 |

## 本地运行

1. 复制 `.env.example` 为 `.env.local`，填入 DeepSeek API Key
2. 安装 Node.js 18+（内置 `fetch`）
3. 双击 `2-启动服务.bat`，或在终端运行 `node server.js`
4. 浏览器打开 `http://localhost:3000`

> 注意：必须通过服务端地址访问，直接双击 `index.html` 无法调用接口。
> 修改 `.env.local` 后需重启服务才生效。

## 安全说明

- API Key 只从服务端环境变量读取，绝不下发到浏览器
- `.env.local` 已在 `.gitignore` 中排除，不会进入版本库
- 错误响应只透传状态码与 Request ID，不含密钥

## 技术栈

原生 HTML / CSS / JavaScript（前端） · Node.js 内置 http + fetch（服务端，无第三方依赖） · DeepSeek `deepseek-flash`
