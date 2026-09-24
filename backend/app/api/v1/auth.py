"""
Auth endpoints — signup, login, refresh, logout, me, profile update.

Routes stay thin: HTTP concerns only; logic lives in AuthService.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import AppError
from app.core.rate_limit import rate_limit
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    LogoutRequest,
    MeResponse,
    RefreshRequest,
    SignupRequest,
    TokenRefreshResponse,
    UpdateProfileRequest,
    company_to_out,
    user_to_out,
)
from app.services.auth import AuthService, EmailAlreadyExists

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/signup",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("signup", limit=10, window_seconds=300))],
)
async def signup(payload: SignupRequest, session: AsyncSession = Depends(get_db)):
    """
    Register a company and its initial SUPER_ADMIN in one transaction.
    Returns a live session (access + refresh tokens).
    """
    return await AuthService(session).signup(payload)


@router.post(
    "/login",
    response_model=AuthResponse,
    dependencies=[Depends(rate_limit("login", limit=10, window_seconds=60))],
)
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_db)):
    """Authenticate by email OR username + password."""
    return await AuthService(session).login(payload.identifier, payload.password)


@router.post(
    "/refresh",
    response_model=TokenRefreshResponse,
    dependencies=[Depends(rate_limit("refresh", limit=30, window_seconds=60))],
)
async def refresh(payload: RefreshRequest, session: AsyncSession = Depends(get_db)):
    """Exchange a valid refresh token for a new access token."""
    access = await AuthService(session).refresh(payload.refresh_token)
    return TokenRefreshResponse(access_token=access)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: LogoutRequest, session: AsyncSession = Depends(get_db)):
    """Revoke the supplied refresh token (stateless access tokens expire on their own)."""
    await AuthService(session).logout(payload.refresh_token)


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)):
    """Authoritative current-user + company payload for session restore."""
    return MeResponse(user=user_to_out(user), company=company_to_out(user.company))


@router.patch("/me", response_model=None)
async def update_me(
    payload: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Edit own name/phone/email."""
    service = AuthService(session)
    if payload.email and payload.email != user.email:
        existing = await service.users.get_by_email(payload.email)
        if existing is not None:
            raise EmailAlreadyExists()
    await service.users.update_profile(
        user, name=payload.name, phone_number=payload.phone, email=payload.email
    )
    await session.commit()
    return user_to_out(user)
