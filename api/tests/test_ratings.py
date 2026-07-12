"""Integration — rating dedup + pinned Phase 6 response shapes."""


async def test_vote_and_read_shape(client):
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    r = await client.get("/api/v1/ratings/jpg-to-png")
    assert r.json() == {"tool_id": "jpg-to-png", "yes": 1, "no": 0}


async def test_dedup_same_fingerprint(client):
    # same client/IP/day/tool → second vote updates, does not add (total stays 1)
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    body = (await client.get("/api/v1/ratings/jpg-to-png")).json()
    assert body["yes"] + body["no"] == 1


async def test_change_vote_updates_bucket(client):
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "no"})
    assert (await client.get("/api/v1/ratings/jpg-to-png")).json() == {
        "tool_id": "jpg-to-png",
        "yes": 0,
        "no": 1,
    }


async def test_invalid_vote_rejected(client):
    r = await client.post("/api/v1/ratings", json={"tool_id": "x", "vote": "maybe"})
    assert r.status_code == 400


async def test_bulk_ratings_admin_only_and_shape(client, admin_client):
    assert (await client.get("/api/v1/ratings")).status_code == 401
    await client.post("/api/v1/ratings", json={"tool_id": "jpg-to-png", "vote": "yes"})
    bulk = (await admin_client.get("/api/v1/ratings")).json()
    assert bulk == [{"tool_id": "jpg-to-png", "yes": 1, "no": 0}]
