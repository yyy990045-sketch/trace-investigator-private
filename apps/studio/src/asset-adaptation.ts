// Bounded facts from the approved Gate 2 assessment; not executable capability definitions.
export const adaptationNotes: Record<string, string> = {
  "CAP-01":
    "已评估的是证据、决策和动作记录语义。需要在新平台独立建立证据接口，不能直接视作已安装的审计服务。",
  "CAP-02":
    "现有RAG客户端分属不同契约，尚未统一适配；没有连接历史远端服务、知识库或数据库。",
  "CAP-04":
    "范围过滤和冲突处理可作为设计参考；仍需适配输入、错误和冲突协议，当前不可调用。",
  "CAP-05":
    "源码实际是影子流量准入，不含持久化人工审批。人工确认需要在后续阶段独立实现。",
  "CAP-08":
    "现有状态机仅作转换规则参考；新平台仍需实现以存储状态校验的事务与事件记录。",
};
