发起/续跑全书分析，或按用户要求单独拉起某个子 Agent。

任务：{{prompt}}

1. get_current_novel + get_current_branch + get_analysis_status。  
2. **若用户点名单域/子 Agent**：再 get_analysis_status(for_agent=目标)，按 launchPlan.sequence **先依赖后目标** 派 agent；不要跑无关域。  
3. 有歧义或已有结果且范围不清时先 ask_question。  
4. 域工作只用 agent(agent_type)；prompt 只带 novelId/branchId，勿指导子 Agent 怎么做。  
5. 本轮做完后 ask_question「是否确认保存」；用户确认后再 finish_novel_analysis(userConfirmed=true)。
