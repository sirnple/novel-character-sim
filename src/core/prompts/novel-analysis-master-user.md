发起/续跑全书分析，或按用户要求单独拉起某个子 Agent。

任务：{{prompt}}

1. get_current_novel + get_current_branch + get_analysis_status（看依赖树、done/pending、optionRules）。  
2. 用户点名单域：for_agent + launchPlan，只跑依赖+目标。  
3. 范围不清时 ask_question：**自己组织无歧义中文选项**（不要含糊的「全部重新分析」；角色要拆名单/详情/关系；写清将运行哪些中文步骤）。  
4. 各域已齐：不要再问确认保存；用户明确要保存再 finish。  
5. 点选后严格按选项字面范围派 agent。
