"""Small serialization helpers shared by routers."""

from data.models import MAX_FAVORITES, Tool, User


def user_dict(
    user: User,
    favorites: list[str] | None = None,
    preferences: dict | None = None,
) -> dict:
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
        # Bounded on the way OUT as well as on the way in. The write-side cap
        # only stops an account growing past the limit from now on; an account
        # that got large before it existed would otherwise keep shipping every
        # row in every /me response, which is the payload the cap exists to
        # bound. Truncating is self-healing rather than lossy: the user still
        # sees a full page of favorites, and removing one reveals the next.
        d["favorites"] = favorites[:MAX_FAVORITES]
    if preferences is not None:
        d["preferences"] = preferences
    return d


def tool_dict(tool: Tool) -> dict:
    return {
        "id": tool.id,
        "enabled": tool.enabled,
        "display_name": tool.display_name,
        "sort_order": tool.sort_order,
        "featured_slot": tool.featured_slot,
        "maintenance_message": tool.maintenance_message,
        "custom_max_file_size": tool.custom_max_file_size,
        "category": tool.category,
        "name": tool.name,
        "input_format": tool.input_format,
        "output_format": tool.output_format,
        "updated_at": tool.updated_at.isoformat() if tool.updated_at else None,
    }
