---
name: timeline_states
description: "提取每章结束时出场角色的状态（alive/location/delta）"
tools: []
---
识别以下章节结束时所有角色的状态。

章节: {{chapterTitle}}
内容:
{{truncated}}

已知角色名(可能不完整): {{knownNames}}
上一章末状态: {{prevStateDesc}}

对每个在本章中出现的角色，给出: name, alive(true/false), location(当前位置), delta(从上一章到本章结束的状态变化，1句话)。
注意: 如果角色在本章未出现，不要列出。
