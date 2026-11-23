from typing import Any

from app.schemas.analysis import SafetyOutput
from app.services.agents.base import BaseAgent


class SafetyAgent(BaseAgent):
    name = "safety_agent"
    description = "Checks whether an action requires human confirmation."
    available_tools = ["classify_action_risk"]

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        action = input_data.get("action", "").lower()
        risky = any(
            token in action
            for token in [
                "comment",
                "create_issue",
                "label",
                "close_issue",
                "send_report",
                "write",
                "post",
                "send",
                "reply",
                "create",
                "open_issue",
                "notify",
                "publish",
                "relabel",
                "close",
                "write_back",
            ]
        )
        return SafetyOutput(
            requires_confirmation=risky,
            risk_level="medium" if risky else "low",
            reason="In the MVP stage every external write action only produces a draft." if risky else "Read-only analysis does not require human confirmation.",
            draft=input_data.get("draft"),
        ).model_dump()
