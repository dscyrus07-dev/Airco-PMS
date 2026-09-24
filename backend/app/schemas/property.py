"""Property write DTOs — matches frontend PropertyCreateRequest."""

import re

from pydantic import BaseModel, Field, field_validator

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,100}$")


class ManagerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: str
    # Optional — backend generates a unique one from name/email when blank
    username: str | None = Field(default=None, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    phone: str | None = Field(default=None, max_length=32)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address.")
        return v

    @field_validator("username")
    @classmethod
    def _username(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip().lower()
        if not v:
            return None
        if not USERNAME_RE.match(v):
            raise ValueError(
                "Username may only contain letters, numbers, dots, hyphens, underscores."
            )
        return v


class PropertyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    location: str = Field(min_length=1, max_length=255)
    city: str = Field(min_length=1, max_length=100)
    state: str = Field(min_length=1, max_length=100)
    manager: ManagerCreate


class PropertyUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    status: str | None = None  # Active | Maintenance | Setup
    manager_name: str | None = None
    manager_email: str | None = None
    manager_phone: str | None = None
