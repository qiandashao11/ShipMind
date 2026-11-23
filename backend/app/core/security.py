from cryptography.fernet import Fernet, InvalidToken


def _derive_demo_key(secret: str) -> bytes:
    # Fernet requires a urlsafe base64-encoded 32-byte key.
    # This deterministic local-development derivation is fine for demos, not for production.
    import base64
    import hashlib

    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())


def encrypt_token(token: str, secret: str) -> str:
    return Fernet(_derive_demo_key(secret)).encrypt(token.encode("utf-8")).decode("utf-8")


def decrypt_token(encrypted: str, secret: str) -> str | None:
    try:
        return Fernet(_derive_demo_key(secret)).decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None
