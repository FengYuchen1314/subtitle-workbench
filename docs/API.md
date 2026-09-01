# API 与自定义服务

## 网页 API

根路径 `/api/v1`。除鉴权状态、登录及初始化外均需 `subtitle_session` Cookie。写请求必须来自本服务同源页面。JSON 请求上限 2 MiB。

| 方法  | 路径                                           | 作用                                                            |
| ----- | ---------------------------------------------- | --------------------------------------------------------------- |
| GET   | `/auth/status`                                 | 初始化与登录状态，不返回凭据                                    |
| POST  | `/auth/setup`                                  | `{setupToken,password}`，仅首次可用                             |
| POST  | `/auth/login`                                  | `{password}`                                                    |
| POST  | `/auth/logout`                                 | 结束会话                                                        |
| GET   | `/projects`、`/providers`、`/jobs`、`/catalog` | 查看状态                                                        |
| POST  | `/rpc`                                         | `{method,args}`，调用下表操作                                   |
| POST  | `/uploads`                                     | `{name,size}`，返回 `{id,offset}`                               |
| GET   | `/uploads/:id`                                 | 查询断点                                                        |
| PATCH | `/uploads/:id`                                 | 原始二进制，`Upload-Offset` 和 `Upload-Checksum`（SHA-256 hex） |
| POST  | `/uploads/:id/complete`                        | 校验、导入项目；失败可恢复上传                                  |
| GET   | `/media/:projectId`                            | 视频读取，支持 Range                                            |
| GET   | `/outputs/:jobId`                              | 下载已完成的 MP4                                                |

RPC 操作：`state`、`catalog`、`media.fonts`、`project.blank`、`project.rename`、`profile.save`、`profile.test`、`profile.delete`、`subtitle.import`、`subtitle.edit`、`subtitle.split`、`subtitle.merge`、`subtitle.replace`、`subtitle.export`、`style.save`、`job.create`、`job.cancel`、`job.retry`、`job.apply`、`library.list`、`library.import`。桌面/安卓提供等价网关，另有原生 `output.save`。

例如单独烧录：

```json
{
  "method": "job.create",
  "args": {
    "id": "project-id",
    "kind": "render",
    "params": {
      "mode": "bilingual",
      "targetLanguage": "en",
      "audioTrack": 0,
      "resolution": 720
    }
  }
}
```

`audioTrack` 是从 0 开始的音频轨道序号，不是容器的绝对流 ID。`mode` 为 `source`、`translation` 或 `bilingual`。`subtitle.export` 的 `args` 为 `{id,format,mode,language}`，返回字幕文本，不启动视频编码。

`job.create.kind` 可为 `transcribe`、`translate`、`segment`、`rewrite` 或 `render`。`segment` 使用 `profileId/maxCharacters/maxDurationMs/minCharacters/instruction`；`rewrite` 使用 `profileId/scope/instruction`，修改译文时还要传 `targetLanguage`。模型只返回稳定 ID 和文字，服务端 / 原生层负责保留或计算时间轴。

`profile.test` 的参数是 `{id}`。它会发起小型真实请求并返回 `{ok,message,checkedAt}`，同时更新配置的联调状态。需要远端音频 URL 的 ASR 会使用已经保存的兼容存储配置。这个操作可能产生少量厂商费用。

## 自定义 ASR：OpenAI 兼容

配置地址是 API 基址（例如 `https://example.com/v1`）。调用 `/audio/transcriptions`，Multipart 字段包含 `file`、`model`、可选 `language`、`response_format=verbose_json` 和段级时间戳请求。返回必须包含原生 `segments` 或 `words`：

```json
{
  "language": "zh",
  "segments": [{ "start": 0.24, "end": 2.8, "text": "你好，世界。" }]
}
```

这里的时间单位是秒。只返回 `{"text":"..."}` 会被拒绝，项目不会编造时间轴。

## 自定义 ASR：字幕 JSON

配置完整 HTTPS 地址；程序直接 POST Multipart `file`（16 kHz、单声道、16-bit WAV）、`model`、可选 `language`，使用可选的 Bearer API Key。同步返回：

```json
{
  "language": "zh",
  "cues": [
    {
      "startMs": 240,
      "endMs": 2800,
      "text": "你好，世界。",
      "speaker": "speaker-1"
    }
  ]
}
```

时间相对于当前音频分片，单位毫秒。程序负责加回分片在原片中的偏移、生成稳定字幕 ID、合并与校验。自定义 JSON 协议首版为同步接口；异步服务需要实现厂商适配器或在服务端代理为同步响应。

## 字幕版本

文档有 `schemaVersion=1`、`revision`、`language`、`cues`。字幕项有 `id/startMs/endMs/text/revision/translations`；译文存入 `translations[language]`，包括 `text/sourceRevision/provider`。文字变化增加字幕项 revision；只改时间不让译文失效。

识别和翻译完成时若发现文档已修改，会保留任务结果供手动应用。烧录始终读取任务创建时的文档和样式快照，重试同一烧录任务不会改变字幕版本。
