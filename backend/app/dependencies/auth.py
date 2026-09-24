"""
Authentication & authorization dependencies.

    get_current_user      — Bearer JWT → User (401 on missing/invalid/expired)
    require_role(*roles)  — 403 when the caller's role isn't allowed
    require_super_admin / require_property_manager / require_employee

The user's company_id is the authoritative tenant scope — services must
filter by current_user.company_id, never trust a client-supplied value.
"""

import uuid
from collections.abc import Callable

from fastapi import Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import AppError
from app.core.security import decode_access_token
from app.models.user import User, UserRole
from app.repositories.user import UserRepository

bearer_scheme = HTTPBearer(auto_error=False)


class Unauthenticated(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "UNAUTHENTICATED"
    message = "Authentication required."


class Forbidden(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "FORBIDDEN"
    message = "You do not have permission to perform this action."


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise Unauthenticated()
    claims = decode_access_token(credentials.credentials)
    if claims is None:
        raise Unauthenticated("Your session has expired. Please sign in again.")
    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except (KeyError, ValueError):
        raise Unauthenticated()

    user = await UserRepository(session).get_by_id(user_id)
    if user is None or not user.is_active:
        raise Unauthenticated("Your session has expired. Please sign in again.")
    return user


def require_role(*roles: UserRole) -> Callable:
    async def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise Forbidden()
        return user

    return _checker


require_super_admin = require_role(UserRole.SUPER_ADMIN)
require_property_manager = require_role(UserRole.SUPER_ADMIN, UserRole.PROPERTY_MANAGER)
require_employee = require_role(
    UserRole.SUPER_ADMIN, UserRole.PROPERTY_MANAGER, UserRole.EMPLOYEE
)
