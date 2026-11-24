"""Password hashing round-trip and tamper resistance."""

from app.passwords import hash_password, verify_password


def test_hash_and_verify():
    stored = hash_password("correct horse")
    assert stored.startswith("scrypt$")
    assert stored != hash_password("correct horse")  # random salt
    assert verify_password("correct horse", stored)
    assert not verify_password("wrong", stored)


def test_verify_rejects_malformed_hashes():
    for stored in (None, "", "plain", "md5$1$2$3$4", "scrypt$x$8$AA==$AA=="):
        assert not verify_password("pw", stored)
