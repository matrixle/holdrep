#!/bin/sh
# 递增版本号并写入当前时间；发布前运行一次：./bump.sh
cd "$(dirname "$0")"
n=$(grep -o "version: 'v[0-9]*'" js/version.js | grep -o '[0-9]*')
printf "/* 版本信息（单一来源）：页面首页与 sw.js 缓存名都读这里。用 ./bump.sh 自动递增。 */\nglobalThis.HR_BUILD = { version: 'v%s', time: '%s' };\n" "$((n+1))" "$(date '+%Y-%m-%d %H:%M')" > js/version.js
cat js/version.js | tail -1
