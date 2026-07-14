"""Small serialization helpers shared by routers."""

from data.models import Tool, User


def user_dict(user: User, favorites: list[str] | None = None) -> dict:
    d = {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "role": user.role,
        "max_file_size": user.max_file_size,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": (
            user.last_login_at.isoformat() if user.last_login_at else None
        ),
    }
    if favorites is not None:
        d["favorites"] = favorites
    return d


def tool_dict(tool: Tool) -> dict:
    return {
        "id": tool.id,
        "enabled": tool.enabled,
        "display_name": tool.display_name,
        "sort_order": tool.sort_order,
        "maintenance_message": tool.maintenance_message,
        "custom_max_file_size": tool.custom_max_file_size,
        "category": tool.category,
        "name": tool.name,
        "input_format": tool.input_format,
        "output_format": tool.output_format,
        "homepage_order": tool.homepage_order,
        "updated_at": tool.updated_at.isoformat() if tool.updated_at else None,
    }
