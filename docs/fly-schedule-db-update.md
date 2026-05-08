# Fly schedule DB 更新流程

用于把本地重新生成的 SQLite schedule DB 上传到 Fly volume `/data`。

JSON 静态数据走 `fly deploy` 进镜像；`src/data/*.db` 被 `.gitignore` 和
`.dockerignore` 排除，必须按下面流程单独上传到 volume。

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

