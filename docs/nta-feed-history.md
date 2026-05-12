# NTA GTFS `route_id` 前缀变更记录

NTA 每次重新发布 GTFS 静态 zip 时，会给每条线路分配新的 `route_id`（格式：`<前缀>_<数字>`，前缀 4 位、后缀 5–6 位）。
逻辑线路（名称、站序）不变，但 string id 全部重编号——我们的 `*-routes.json` / `*-shapes.json`
如果没跟着重生成，`getAllBusVehicles` 就会把线上车辆过滤光。

这个文件用来记录已观察到的前缀变化，方便自己总结 NTA 的发布节奏。

## 各 agency 当前前缀快照

来源：`~/Downloads/GTFS_Realtime/routes.txt`（NTA 发布于 **2026-04-25**，本地下载于 **2026-04-26**）

| agency_id | 名称                          | 前缀        | 线路数 | 备注                  |
|-----------|-------------------------------|-------------|--------|-----------------------|
| 7778019   | Dublin Bus                    | `5570`      | 116    |                       |
| 7778020   | Bus Éireann                   | `5578`      | 205    | **新**（原 `5549`）   |
| 7778020   | Bus Éireann                   | `5502`      | 1      | Limerick 310 路，稳定 |
| 7778008   | Bus Éireann Waterford         | `5501`      | 5      | 目前被生成脚本忽略    |
| 7778021   | Go-Ahead Ireland              | `5398`      | 44     |                       |
| 7778006   | Go-Ahead Ireland              | `5576`      | 20     |                       |
| 7778017   | Iarnród Éireann / Irish Rail  | `5609`      | 18     |                       |
| 7778014   | LUAS                          | `5242`      | 2      |                       |

## 变更时间线

| 观察日期       | agency          | 旧前缀  | 新前缀  | 来源                                      |
|----------------|-----------------|---------|---------|-------------------------------------------|
| 2026-04-14     | Bus Éireann     | —       | `5549`  | 仓库 `./gtfs/routes.txt` 文件 mtime       |
| 2026-04-17     | Bus Éireann     | `5549`  | `5549`  | 无变化，commit `56f5da7` 首次生成 JSON    |
| 2026-04-22     | Dublin Bus      | `5570`  | `5570`  | 无变化，commit `98a981a` 重生成后仍是     |
| **2026-04-23** | **Bus Éireann** | `5549`  | `5578`  | NTA 新发布的 GTFS zip（用户 4-24 下载）   |
| 2026-04-25     | 全部 agency     | —       | 不变    | NTA 重发 zip，前缀未滚（用户 4-26 下载）  |
| 2026-04-27     | Dublin Bus      | `5570`  | `5579`  | NTA zip（user 4-26 已 regen 一次）        |
| **2026-04-29** | **全部 agency** | 见下    | **schema 整体重写** | NTA zip 直接换了 route_id 格式 |
| 2026-04-30     | 全部 agency     | —       | 不变    | NTA 重发 zip，schema 与 4-29 一致         |
| 2026-05-01     | 全部 agency     | —       | 不变    | zip 5-01 22:02 UTC 补传带 UUID `3035A46D`（mode D 闭环）；route_id 集合 0 漂；`feed_start_date` 滑到 20260501，`trips.txt` 126,260 → 154,281（+28,021，新班次/时刻表微调，不影响 trip_id schema） |
| 2026-05-02     | —              | —       | 跳过    | NTA 没补 5-2 zip——5-3 22:03 UTC 直接从 5-01 `3035A46D` 发到 `FA3F92F8`，5-2 `0839437A` 整个 zip 版本被跳过（lightweight 可以在没有对应 zip 的 UUID 上停整整一天） |
| 2026-05-03     | 全部 agency     | —       | 不变    | zip 5-03 22:03 UTC 跟 lightweight 同步发 `FA3F92F8`（**未触发 mode D**）；route_id 集合 0 漂；bus trip 前缀分布 0 变化（`5579`+`5645` 各 28,027 仍并存——Dublin Bus 5-17 改时刻表的事还在）；rail `5636` -461 trip（仅 timetable 微调，不影响 bus） |
| 2026-05-07     | 全部 agency     | —       | 不变    | zip 5-07 22:03 UTC 发布 `CE1ED411`；route_id 集合 0 漂；`trips.txt` 126,264 → 142,321（+16,057），`stop_times.txt` +1,229,658；Dublin Bus trip 数翻倍到 56,054，Bus Éireann/Go-Ahead/rail 仅时刻表调整 |
| 2026-05-11     | 全部 agency     | —       | 不变    | zip 5-11 22:20 UTC 发布 `110F282B`；route_id 集合 0 漂；本地 `*-routes.json` / `train-routes.json` 与 zip 全量对齐，无需 regen；`trips.txt` 139,713（较 5-07 -2,608），`stop_times.txt` 5,494,119 |

### 2026-05-01：第四种故障模式——轻量端点比 zip 跑得快

之前观察到的三种发布模式都是滚前缀 / 改 schema / 重发 zip 但前缀不变，
共同点是 **zip 一定被重新上传了**。这次不一样：

- workflow 在 22:36 UTC 看到 `feed_info.txt`（轻量端点）UUID 变成了 `3035A46D`
- 但同一时刻 curl `GTFS_Realtime.zip`，CDN 返回 `Last-Modified: Thu, 30 Apr 2026 22:14:56 GMT`，82 MB 文件没动
- 解压 zip 取里面的 `feed_info.txt`，UUID 还是 `7255571F`（4-30 那次的）

也就是 NTA 的发布管线先把 `feed_info.txt` 元数据滚了，再去重新打包/上传 zip，中间有个 gap。
对我们的影响：
- workflow 提前一拍开 issue，但此刻去 regen 是没意义的（数据还是旧的）
- 真正要看变化要等 zip 的 `Last-Modified` 推过来再 diff，否则前缀比对都拿不到新数据
- 排查口诀：**UUID 看到变了，先 `curl -I` 看 zip 的 `Last-Modified`，没动就是这种 4 号模式，等就行**

### 2026-04-29 的变更不是滚前缀，是改 schema

`route_id` 从 `<4 位前缀>_<5–6 位数字>` 改成了带空格的多段编码，三个 operator 同时换：

| operator         | 旧                 | 新（举例）           |
|------------------|--------------------|----------------------|
| Dublin Bus       | `5579_131840`      | `1 1 e a`            |
| Bus Éireann      | `5578_xxxxxx`      | `2 100 c e`          |
| Bus Éireann WFRD | `5501_xxxxxx`      | `WFRD W1 c c`        |
| Go-Ahead (3)     | `5398_xxxxxx`      | `3 102 d a`          |
| Go-Ahead (03C)   | `5576_xxxxxx`      | `03C 120 e a`        |
| Iarnród Éireann  | `5609_xxxxxx`      | `BRAY-HOWTH-I`       |
| LUAS             | `5242_1` / `5242_2`| `10000 GREEN g a`    |

第一段大致对应 agency（`1` Dublin Bus / `2` Bus Éireann / `3` & `03C` Go-Ahead 的两半 / `WFRD` Bus Éireann Waterford），第二段是 `route_short_name`。
`trip_id` 仍然是 `<prefix>_<num>` 格式但 prefix 也都换了（如 Go-Ahead `5576_713`），所以 schedule .db 也得重生成 + 重传 Fly volume。
realtime `Vehicles` / `TripUpdates` feed 同步切到了新编码——三个 operator 同时静态+动态都换，不像 4-23 那次只滚 Bus Éireann 前缀。

## NTA 自己声明的发布日（`feed_info.txt`）

| 观察日期   | `feed_start_date` | `feed_version` (UUID)                  | 距上次 |
|------------|-------------------|----------------------------------------|--------|
| 2026-04-14 | 20260414          | `362FED45-B5F1-4D6C-B51B-906922AC6AF0` | —      |
| 2026-04-23 | 20260423          | `49433242-3F07-4245-8C25-460F0EE6851E` | 9 天   |
| 2026-04-25 | 20260425          | `3F733077-EF7E-4C1B-84F4-1BF3AA9FF788` | 2 天   |
| 2026-04-27 | 20260427          | `1B949A1D-9DDF-48B6-9217-D91D48FD8D04` | 2 天   |
| 2026-04-29 | 20260429          | `E3B0A11B-0BF2-43A9-A25A-5D64C5A79BAC` | 2 天   |
| 2026-04-30 | 20260430          | `7255571F-A5F5-4507-BC91-D0384F6935CD` | 1 天   |
| 2026-05-01 | 20260501          | `3035A46D-8FA6-419D-A378-D17A033B154F` | 1 天   |
| 2026-05-02 | 20260502          | `0839437A-650C-4D86-B368-2AEBE0B60DBF` | 1 天   |
| 2026-05-03 | 20260503          | `FA3F92F8-B7BE-44ED-AEEF-6712BE80E03B` | 1 天   |
| 2026-05-07 | 20260507          | `CE1ED411-4C10-4C2A-864C-15248C162CB1` | 4 天   |
| 2026-05-11 | 20260511          | `110F282B-11F2-40BE-ACF7-379FCA2A45F6` | 4 天   |

> **注意**：5-1 / 5-2 / 5-3 都是从轻量 `feed_info.txt` 端点读的。`3035A46D` 5-01 22:02 UTC
> 进了 zip（mode D 闭环、issue 自愈）；**`0839437A` 从未进 zip**——NTA 5-3 22:03 UTC 直接
> 发 `FA3F92F8` 把 5-2 版本整个跳过；`FA3F92F8` 跟 lightweight 同步发，未触发 mode D。
> 经验：mode D 不一定靠"补传同 UUID"收尾，也可能直接发下一个 UUID 跳过去。

每次发布 UUID 都是新的，`feed_end_date` 恒为 start + 1 年。
**3 个数据点（9 天、2 天间隔）已经足够否定"周发"假设——NTA 是不定期重发**，
prefix 也不是每次都滚（4-25 这次重发 7 个 agency 前缀全没动）。继续累积下次再看。

## 其它 agency 的稳定区间

从 4-14 到 4-26 这 12 天窗口里，以下前缀都没变，可作为"变/没变"的对照：

- Dublin Bus `5570` — 12 天不变
- Go-Ahead `5398` + `5576` — 12 天不变
- Bus Éireann 的 `5502`（Limerick 310 一条单独线）— 12 天不变
- 4-25 这次重发：**7 个 agency 前缀全部不变**（含上次刚滚的 Bus Éireann `5578`）

## 怎么快速检查有没有漂移

对比本地静态 JSON 的前缀和线上 Vehicles feed 的前缀，发现不匹配就说明 NTA 滚版本了。

```bash
# 1. 本地 JSON 当前认的前缀
for op in buseireann dublinbus goahead; do
  echo "-- $op --"
  jq -r '[.[] | .id | split("_")[0]] | unique | .[]' "src/data/${op}-routes.json"
done

# 2. 线上 Vehicles feed 当前用的前缀
set -a; source .env; set +a
curl -s -H "x-api-key: $NTA_API_KEY" \
  "https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json" \
  | jq -r '[.entity[] | .vehicle.trip.route_id // empty | split("_")[0]] | group_by(.) | map({prefix: .[0], count: length}) | .[] | "\(.prefix): \(.count)"'
```

两边对不上就得重跑生成脚本。

## 下次发现漂移时要记什么

1. 哪个 agency
2. 旧前缀 → 新前缀
3. `feed_info.txt` 里 NTA 自己声明的 `feed_start_date` / `feed_end_date`（看它是每周几/几号发布）
4. 与上次发布的间隔天数

累积几次后就能看出是每周还是每月还是没规律。
