Start, continue, or run a single analysis sub-agent as requested.

Task: {{prompt}}

1. Status first (get_analysis_status).  
2. If user names one domain: get_analysis_status(for_agent=…) and follow launchPlan.sequence (deps then target).  
3. ask_question when ambiguous. Domain via agent(agent_type).  
4. When done, ask to confirm save, then finish_novel_analysis only if confirmed.
