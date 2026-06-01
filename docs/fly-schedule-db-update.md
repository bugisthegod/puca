# Fly schedule DB 更新流程

用于把本地重新生成的 SQLite schedule DB 上传到 Fly volume `/data`。

JSON 静态数据走 `fly deploy` 进镜像；`src/data/*.db` 被 `.gitignore` 和
`.dockerignore` 排除，必须按下面流程单独上传到 volume。

## GitHub Actions 一键更新

如果只是更新 schedule DB，可以用 GitHub runner 下载 NTA GTFS、生成 DB，并上传到
Fly volume，避免本地慢网速上传大文件。

第一次使用前：

```bash
fly tokens create deploy -a puca
```

把输出保存到 GitHub repo secret：

- `Settings` → `Secrets and variables` → `Actions`
- 新建 `FLY_API_TOKEN`

手动运行：

- 打开 GitHub repo 的 `Actions`
- 选择 `Prepare data update PR`
- 点击 `Run workflow`

`Prepare data update PR` 会：

1. 下载最新 `GTFS_Realtime.zip`
2. 解压到 runner 的 `gtfs/`
3. 对比 zip 内的 `feed_info.txt` `feed_version` 和 repo 里的 `.github/data/feed_info.txt`
4. 如果版本相同，直接跳过
5. 如果版本不同或 marker 不存在，执行 `bun run json:generate`
6. 把 `src/data/*.json` 和 `.github/data/feed_info.txt` 放进同一个 PR
7. 不等待 PR merge，继续执行 `bun run db:generate`
8. 对三个 SQLite DB 跑 `PRAGMA integrity_check` 和 row count 检查
9. 执行 `bun run db:upload`
10. 上传到 `/data/*.db.new`，校验远端文件大小
11. 原子 `mv` 替换正式 DB
12. 每替换完一个 DB 后重启 Fly app，释放旧 SQLite 文件句柄

Repo 里追踪的 `.github/data/feed_info.txt` 是“已确认处理”的标准 marker；它替代了
旧的 `.github/data/last-feed-uuid`，但保留了完整 `feed_info.txt` 内容。

没有自动 feed checker；入口是手动 `Prepare data update PR`。判断是否继续时，workflow 会
下载完整 zip，并读取 zip 内的 `feed_info.txt`，不要用轻量 `feed_info.txt` 端点。

如果 NTA route/stops/shapes 静态 JSON 也发生变化，不要只跑这个 workflow；需要先更新
JSON 并正常 `fly deploy`，再更新 volume DB。

## 推荐顺序

如果 JSON 也更新了，先部署镜像：

```bash
fly deploy
```

然后上传 DB。上传流程必须保持串行：上传 `.new` 临时文件，确认上传命令成功返回后，
立刻用同一文件系统上的 `mv` 原子替换正式 DB。三个 DB 都替换完之后再重启 app。

## 预检

```bash
fly machine list -a puca
fly ssh console -a puca -C "sh -c 'df -h /data && ls -la /data/'"
```

确认：

- machine 是 `started`
- `/data` 剩余空间足够放下最大的 `.db.new`
- 没有上次失败残留的 `.new` 文件

## 上传并替换

```bash
# Dublin Bus
fly sftp put src/data/bus-schedule.db /data/bus-schedule.db.new -a puca
fly ssh console -a puca -C "mv /data/bus-schedule.db.new /data/bus-schedule.db"

# Bus Eireann
fly sftp put src/data/buseireann-schedule.db /data/buseireann-schedule.db.new -a puca
fly ssh console -a puca -C "mv /data/buseireann-schedule.db.new /data/buseireann-schedule.db"

# Go-Ahead
fly sftp put src/data/goahead-schedule.db /data/goahead-schedule.db.new -a puca
fly ssh console -a puca -C "mv /data/goahead-schedule.db.new /data/goahead-schedule.db"
```

## 失败重试

如果 `fly sftp put` 中途断线，只会影响 `.new` 临时文件。正式 DB 还没有被替换。
先删除半截 `.new`，再重跑对应的 `sftp put`。

```bash
fly ssh console -a puca -C "rm -f /data/bus-schedule.db.new"
fly ssh console -a puca -C "rm -f /data/buseireann-schedule.db.new"
fly ssh console -a puca -C "rm -f /data/goahead-schedule.db.new"
```

只删失败的那个 `.new` 即可。

## 重启

三个 DB 都替换后，重启 app，让进程关闭旧文件句柄并重新打开新的 DB：

```bash
fly apps restart puca
```

## 最后检查

```bash
fly ssh console -a puca -C "sh -c 'ls -lh /data && df -h /data'"
fly machine list -a puca
curl -I https://puca.dev
```

`/data` 下应该只有正式 DB 文件，没有 `.new` 残留；`puca.dev` 应返回 `HTTP/2 200`。
