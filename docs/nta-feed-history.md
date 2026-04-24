# NTA GTFS `route_id` 前缀变更记录

NTA 每次重新发布 GTFS 静态 zip 时，会给每条线路分配新的 `route_id`（格式：`<前缀>_<数字>`，前缀 4 位、后缀 5–6 位）。
逻辑线路（名称、站序）不变，但 string id 全部重编号——我们的 `*-routes.json` / `*-shapes.json`
如果没跟着重生成，`getAllBusVehicles` 就会把线上车辆过滤光。

这个文件用来记录已观察到的前缀变化，方便自己总结 NTA 的发布节奏。

## 各 agency 当前前缀快照

来源：`~/Downloads/GTFS_Realtime (1)/routes.txt`（NTA 发布于 **2026-04-23**，本地下载于 **2026-04-24**）

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

## NTA 自己声明的发布日（`feed_info.txt`）

| 观察日期   | `feed_start_date` | `feed_version` (UUID)                  | 距上次 |
|------------|-------------------|----------------------------------------|--------|
| 2026-04-14 | 20260414          | `362FED45-B5F1-4D6C-B51B-906922AC6AF0` | —      |
| 2026-04-23 | 20260423          | `49433242-3F07-4245-8C25-460F0EE6851E` | 9 天   |

每次发布 UUID 都是新的，`feed_end_date` 恒为 start + 1 年。
**目前只有 2 个数据点，9 天间隔不足以判断是周发还是不定期。** 每次重新下载 zip 时把
`feed_info.txt` 头两行贴进上表，累积 4–5 次就能看出节奏。

## 其它 agency 的稳定区间

从 4-14 到 4-24 这 10 天窗口里，以下前缀都没变，可作为"变/没变"的对照：

- Dublin Bus `5570` — 10 天不变
- Go-Ahead `5398` + `5576` — 10 天不变
- Bus Éireann 的 `5502`（Limerick 310 一条单独线）— 10 天不变

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
