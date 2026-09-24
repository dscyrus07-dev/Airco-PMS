"""Auth flow tests — isolated in-memory DB (never touches Supabase)."""

import pytest

SIGNUP = {
    "company_name": "Acme Hospitality",
    "brand_name": "Acme Stays",
    "address": "12 Assi Ghat Road, Varanasi",
    "pin_code": "221005",
    "email": "admin@acme.test",
    "phone": "+91 98100 12345",
    "password": "Secret@123",
    "confirm_password": "Secret@123",
}

LOGIN_ID = {"identifier": "admin@acme.test", "password": "Secret@123"}


async def _signup(client) -> dict:
    res = await client.post("/api/v1/auth/signup", json=SIGNUP)
    assert res.status_code == 201, res.text
    return res.json()


@pytest.mark.asyncio
async def test_signup_success(client):
    body = await _signup(client)
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["user"]["role"] == "super_admin"
    assert body["user"]["username"]
    assert body["user"]["email"] == "admin@acme.test"
    assert body["company"]["name"] == "Acme Hospitality"
    # secrets must never appear in responses
    assert "password" not in body["user"]
    assert "password_hash" not in body["user"]


@pytest.mark.asyncio
async def test_signup_duplicate_email_rejected(client):
    await _signup(client)
    res = await client.post("/api/v1/auth/signup", json=SIGNUP)
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_signup_validation_errors(client):
    bad = dict(SIGNUP, pin_code="123", email="not-an-email", password="short",
               confirm_password="short")
    res = await client.post("/api/v1/auth/signup", json=bad)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_signup_password_mismatch(client):
    res = await client.post(
        "/api/v1/auth/signup", json=dict(SIGNUP, confirm_password="Different@1")
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_login_by_email(client):
    await _signup(client)
    res = await client.post("/api/v1/auth/login", json=LOGIN_ID)
    assert res.status_code == 200
    assert res.json()["user"]["role"] == "super_admin"


@pytest.mark.asyncio
async def test_login_by_username(client):
    body = await _signup(client)
    username = body["user"]["username"]
    res = await client.post(
        "/api/v1/auth/login",
        json={"identifier": username, "password": "Secret@123"},
    )
    assert res.status_code == 200
    assert res.json()["user"]["username"] == username


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    await _signup(client)
    res = await client.post(
        "/api/v1/auth/login",
        json={"identifier": "admin@acme.test", "password": "Wrong@1234"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user_same_error(client):
    res = await client.post(
        "/api/v1/auth/login",
        json={"identifier": "ghost@nowhere.test", "password": "Whatever@1"},
    )
    assert res.status_code == 401
    assert res.json()["detail"]["message"] == "Invalid email/username or password."


@pytest.mark.asyncio
async def test_me_requires_auth(client):
    res = await client.get("/api/v1/auth/me")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_and_company(client):
    body = await _signup(client)
    res = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["email"] == "admin@acme.test"
    assert data["company"]["company_uid"] == data["user"]["company_uid"]


@pytest.mark.asyncio
async def test_refresh_and_logout(client):
    body = await _signup(client)
    # exchange refresh → new access token
    res = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
    )
    assert res.status_code == 200
    assert res.json()["access_token"]

    # logout revokes the refresh token
    res = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": body["refresh_token"]}
    )
    assert res.status_code == 204

    # revoked token can no longer mint access tokens
    res = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_garbage_token_rejected(client):
    res = await client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer not-a-token"}
    )
    assert res.status_code == 401
