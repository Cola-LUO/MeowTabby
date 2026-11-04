# billing-backend 提示词透传与通用流式端点 — 实施计划（后端切片）

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 billing-backend 接收前端已组装好的提示词（完整透传），以通用 SSE 流式端点 `/v1/generate` 承接全部托管 AI 功能，账户流改为验证码制，并退役旧的 `/translate` 契约。

**Architecture:** 在已裁定的计费内核（事务结算、部分结算钳制、在途并发=1、审计）之上增量扩展：新增幂等缓存表与通用流式端点；扣费闸门从"估算上界"改为"余额>0 放行 + 真实 usage 结算 + 扣到零钳制"；工作线程消费上游流并投递 SSE 事件，客户端掉线不中断结算；`/v1/cancel` 掐断上游减少损失。

**Tech Stack:** Python 3.14 / FastAPI / pydantic v2 / SQLite（WAL）/ OpenAI SDK（stream=True）/ pytest + TestClient + httpx ASGITransport。

**Spec:** `/Users/Luo_F/vs_code/MeowTabby/specs/superpowers/specs/2026-08-26-billing-prompt-passthrough-design.md`（执行者必须同时读规格与本计划；冲突以规格为准并上报）

## Global Constraints

- 金额全程 1e-8 元整数单位；`cost = model_cost + service_fee` 恒等式对**所有**落账行成立（F3/F27，禁止改动）。
- 字段上限（计费安全参数）：`system_prompt` 1–4000 字符；`prompt` 1–20000 字符；`max_output_tokens` 1–8192，默认 4096；`request_id` 1–64 字符；`feature` 1–64 字符。超限必须 422。
- 闸门：排队后取**新鲜**余额，`>0` 放行，`=0` 返回 402；结算按真实 usage，余额不足扣到 0 且照常交付（F8/F27 语义不改）。
- 每用户在途并发上限 1（单进程；超限 429）；信号量持有延伸至"流结束 + 结算完成"。
- 超时：首块 ≤60s、单次调用总时长 ≤120s（常量，测试可 patch）。
- 幂等：TTL 600s；已完成→重放不重扣；在途→409；失败/取消→行删除、同 id 可重入。
- 掉线：继续消费上游流至结束并照常结算（杜绝逃单）。取消：立即掐上游，已生成部分按启发式上界结算、审计串前缀 `cancelled:`、幂等行删除。
- 验证码：6 位数字、哈希落库（`_tok_digest`）、10 分钟有效、每邮箱 10 分钟最多试 5 次、用后即废；重发 3 次/10 分钟（既有）。
- 不改语义的既有裁定：F1、F3–F19、F25–F32（测试移植后必须继续绿）。
- 测试命令（唯一验收口径）：`cd /Users/Luo_F/vs_code/billing-backend && .venv/bin/pytest test_billing.py test_generate.py -v`，全绿才算完成。
- Conventional Commits（`feat(billing):` / `test(billing):` / `docs(billing):`）。
- billing-backend 原本**不是** git 仓库：Task 0 先备份原件再 `git init`；此后每任务一次提交。

## File Structure

| 文件               | 职责                                           | 本计划中的动作                                                   |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------- |
| `main.py`          | FastAPI 应用全部逻辑（现状单文件）             | 修改：账户验证码、幂等、`/v1/generate`、`/v1/cancel`、删除旧契约 |
| `test_billing.py`  | 账户与计费回归测试                             | 修改：helper 验证码化、账户新测试、旧 `/translate` 用例移植/删除 |
| `test_generate.py` | 新契约（`/v1/generate`、`/v1/cancel`）全部测试 | 新建                                                             |
| `README.md`        | 自包含文档（接口清单/快速开始）                | Task 10 更新                                                     |
| `.gitignore`       | 忽略 `.venv/`、`usage.db`、`__pycache__/` 等   | Task 0 新建                                                      |

测试分工：`test_generate.py` 从 `test_billing` 导入共享工具（`register_and_verify`、`recharge`、`auth`、`db`、`fake_usage`、`make_client`、`COST_57_11`）——两文件同目录，pytest 根目录插入保证可导入。

---

### Task 0: 工作区准备与基线

**Files:**

- Create: `.gitignore`
- Backup: `main.py`、`test_billing.py`、`README.md`、`requirements.txt` → `../billing-backend-backup/`

**Interfaces:**

- Produces: 可运行的 git 仓库 + 全绿基线（28 passed），后续所有任务的提交与回归基础。

- [ ] **Step 1: 备份原件（非 VCS 目录，改前必备份）**

```bash
cd /Users/Luo_F/vs_code/billing-backend
mkdir -p ../billing-backend-backup
cp main.py test_billing.py README.md requirements.txt ../billing-backend-backup/
ls ../billing-backend-backup/   # 必须看到 4 个文件
```

- [ ] **Step 2: 建 .gitignore**

```
.venv/
__pycache__/
*.pyc
usage.db
usage.db-wal
usage.db-shm
.DS_Store
```

- [ ] **Step 3: git init + 基线提交**

```bash
git init
git add .gitignore main.py test_billing.py README.md requirements.txt static
git commit -m "chore(billing): baseline before prompt-passthrough slice"
```

- [ ] **Step 4: 验证环境与基线**

```bash
test -x .venv/bin/pytest || { python3 -m venv .venv && .venv/bin/pip install -r requirements.txt; }
.venv/bin/pytest test_billing.py -q
```

Expected: `28 passed`（2026-08-26 实测基线，6.4s）。若 alibabacloud 依赖装不上，退化为 `.venv/bin/pip install fastapi "uvicorn[standard]" openai pydantic pytest httpx`（DM SDK 仅发真邮件需要，`send_email` 对其 ImportError 有降级分支，测试不受影响）。

---

### Task 1: 账户流改验证码——注册/激活/重发

**Files:**

- Modify: `main.py`（`_MAIL_TEMPLATES`、`send_email`、`/register`、`/resend-verify`，新增 `/verify-code`、`_mint_code`、`_VERIFY_ATTEMPT_LIMITER`、`VerifyCodeReq`）
- Test: `test_billing.py`（新增验证码用例；`register_and_verify` helper 改验证码式）

**Interfaces:**

- Consumes: `_tok_digest`、`_SlidingWindowLimiter`、`_RESEND_LIMITER`、`users.verify_token/verify_expire/email_verified` 列
- Produces: `_mint_code() -> str`（6 位数字）；`send_email(to: str, template: str, code: str) -> bool`（第三参数语义从"链接"变为"验证码"，模板占位符 `{code}`）；`POST /verify-code {email, code}`；`_VERIFY_ATTEMPT_LIMITER`；**helper `register_and_verify(c, email, password)` 改为验证码式且签名不变**（后续所有任务依赖它）

- [ ] **Step 1: 写失败测试（追加到 test_billing.py 尾部）**

```python
def test_register_sends_code_and_verify_code_activates():
    c = make_client()
    codes = {}
    def _send(_to, template, code):
        codes[template] = code
        return True
    with mock.patch.object(main, "send_email", _send):
        r = c.post("/register", json={"email": "vc@test.com", "password": "pass12345"})
    assert r.status_code == 200 and r.json()["mail_sent"] is True
    code = codes["verify"]
    assert len(code) == 6 and code.isdigit()
    with db() as conn:  # 库里只有哈希，无明文码
        row = conn.execute("SELECT verify_token, email_verified FROM users WHERE email='vc@test.com'").fetchone()
    assert row["verify_token"] != code and row["email_verified"] == 0
    r = c.post("/verify-code", json={"email": "vc@test.com", "code": code})
    assert r.status_code == 200
    with db() as conn:
        row = conn.execute("SELECT email_verified, verify_token FROM users WHERE email='vc@test.com'").fetchone()
    assert row["email_verified"] == 1 and row["verify_token"] is None  # 用后即清
    assert c.post("/login", json={"email": "vc@test.com", "password": "pass12345"}).status_code == 200


def test_verify_code_wrong_attempts_lock_and_expiry():
    c = make_client()
    codes = {}
    def _send(_to, template, code):
        codes[template] = code
        return True
    with mock.patch.object(main, "send_email", _send):
        c.post("/register", json={"email": "vl@test.com", "password": "pass12345"})
    for _ in range(5):
        assert c.post("/verify-code", json={"email": "vl@test.com", "code": "000000"}).status_code == 400
    r = c.post("/verify-code", json={"email": "vl@test.com", "code": codes["verify"]})
    assert r.status_code == 429  # 试错锁定后即使真码也拒
    # 过期码无效
    with mock.patch.object(main, "send_email", _send):
        c.post("/register", json={"email": "ve@test.com", "password": "pass12345"})
    with db() as conn:
        conn.execute("UPDATE users SET verify_expire='2000-01-01T00:00:00+00:00' WHERE email='ve@test.com'")
        conn.commit()
    assert c.post("/verify-code", json={"email": "ve@test.com", "code": codes["verify"]}).status_code == 400


def test_resend_verify_refreshes_code_and_invalidates_old():
    c = make_client()
    codes = []
    def _send(_to, template, code):
        codes.append(code)
        return True
    with mock.patch.object(main, "send_email", _send):
        c.post("/register", json={"email": "vr@test.com", "password": "pass12345"})
        r = c.post("/resend-verify", json={"email": "vr@test.com"})
    assert r.status_code == 200 and r.json()["mail_sent"] is True
    old, new = codes[0], codes[1]
    assert old != new
    assert c.post("/verify-code", json={"email": "vr@test.com", "code": old}).status_code == 400
    assert c.post("/verify-code", json={"email": "vr@test.com", "code": new}).status_code == 200


def test_degraded_mail_prints_code_not_link(capfd):
    c = make_client()
    with mock.patch.object(main, "ALLOW_DEGRADED_MAIL", True):
        r = c.post("/register", json={"email": "dm@test.com", "password": "pass12345"})
    assert r.status_code == 200 and r.json()["mail_sent"] is False
    out = capfd.readouterr().out
    assert "[mail:degraded]" in out and "token=" not in out and "link=" not in out
```

同时把 `register_and_verify` helper 改为：

```python
def register_and_verify(c, email, password="pass12345"):
    codes = {}
    def _send(_to, template, code):
        codes[template] = code
        return True
    with mock.patch.object(main, "send_email", _send):
        r = c.post("/register", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        r = c.post("/verify-code", json={"email": email, "code": codes["verify"]})
        assert r.status_code == 200, r.text
    r = c.post("/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["session_id"], r.json()["user_id"]
```

并把既有用例中对旧链接流程的直接引用改掉：`test_resend_verify_after_mail_failure`（改用验证码：注册→`/resend-verify`→`/verify-code`→登录，仍断言库里存哈希非明文）、`test_default_mail_mode_never_prints_link`（断言不含 `token=`/`link=` 即可，文案改为提示 `/resend-verify`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/Luo_F/vs_code/billing-backend && .venv/bin/pytest test_billing.py -q`
Expected: 新用例 FAIL（`/verify-code` 404），改动后的既有用例 FAIL（`send_email` 仍收链接）。

- [ ] **Step 3: 实现**

```python
# 限流器区新增
_VERIFY_ATTEMPT_LIMITER = _SlidingWindowLimiter(5, 10 * 60)   # 验证码试错：10 分钟 5 次

class VerifyCodeReq(BaseModel):
    email: str = Field(..., max_length=254)
    code: str = Field(..., min_length=6, max_length=6)

def _mint_code() -> str:
    """6 位数字验证码（secrets 逐位抽取）。"""
    return "".join(secrets.choice("0123456789") for _ in range(6))
```

`_MAIL_TEMPLATES` 两个模板正文改为验证码文案（占位符 `{code}`）：

```python
_MAIL_TEMPLATES = {
    "verify": {
        "subject": "请验证您的邮箱",
        "body": "您正在注册翻译计费服务。您的验证码：{code}（10 分钟内有效）。如非本人操作，请忽略本邮件。",
    },
    "reset": {
        "subject": "重置您的密码",
        "body": "您正在重置翻译计费服务的密码。您的验证码：{code}（10 分钟内有效）。如非本人操作，请忽略本邮件。",
    },
}
```

`send_email(to, template, link)` 的第三参数改名 `code`，正文渲染 `tpl["body"].format(code=code)`；**降级打印行改为** `code=<code>` 之外**不含** `token=`/`link=` 字样（把 `link={link}` 字样整体去掉，输出 `to=... template=...`（降级模式可打印验证码本身，便于开发联调））。`/register` 中 `verify_token = _mint_code()`，落库仍 `_tok_digest(code)`，响应文案与 `mail_sent` 逻辑不变。新增：

```python
@app.post("/verify-code")
def verify_code(req: VerifyCodeReq):
    if _VERIFY_ATTEMPT_LIMITER.blocked(req.email):
        raise HTTPException(status_code=429, detail="尝试次数过多，请 10 分钟后再试")
    now = _now_iso()
    with _db_conn() as conn:
        row = conn.execute(
            "SELECT user_id, email_verified, verify_token, verify_expire FROM users WHERE email=?",
            (req.email,),
        ).fetchone()
        if row is None or row["email_verified"] or row["verify_token"] is None \
                or row["verify_expire"] <= now or _tok_digest(req.code) != row["verify_token"]:
            _VERIFY_ATTEMPT_LIMITER.record(req.email)
            raise HTTPException(status_code=400, detail="验证码无效或已过期")
        conn.execute(
            """UPDATE users SET email_verified=1, verify_token=NULL,
               verify_expire=NULL, updated_at=? WHERE user_id=?""",
            (now, row["user_id"]),
        )
        conn.commit()
    _VERIFY_ATTEMPT_LIMITER.clear(req.email)
    return {"message": "邮箱验证成功，现在可以登录"}
```

`/resend-verify`：`verify_token = _mint_code()` 其余不变（统一文案防枚举保留）。`GET /verify` 本任务暂留（Task 2 删）。

- [ ] **Step 4: 全绿**

Run: `.venv/bin/pytest test_billing.py -q`
Expected: 全部 PASS（28 项基线中个别改写后仍全绿 + 新增用例）。

- [ ] **Step 5: Commit**

```bash
git add main.py test_billing.py
git commit -m "feat(billing): code-based email verification for register/verify/resend"
```

---

### Task 2: 账户流改验证码——找回/重置 + 删除链接端点

**Files:**

- Modify: `main.py`（`/forgot-password`、`/reset-password`、`ResetPasswordReq`、`_RESET_ATTEMPT_LIMITER`；删除 `GET /verify`；`send_email` 凭证检查去掉 `APP_BASE_URL`）
- Test: `test_billing.py`

**Interfaces:**

- Consumes: Task 1 的 `_mint_code`、模板 `{code}`
- Produces: `POST /reset-password {email, code, new_password}`；`send_email` 不再要求 `APP_BASE_URL`（`/health` 的 `mail_configured` 口径同步去掉该项）

- [ ] **Step 1: 写失败测试**

```python
def test_forgot_and_reset_with_code():
    c = make_client()
    sid, uid = register_and_verify(c, "fp@test.com")
    codes = {}
    def _send(_to, template, code):
        codes[template] = code
        return True
    with mock.patch.object(main, "send_email", _send):
        r = c.post("/forgot-password", json={"email": "fp@test.com"})
    assert r.status_code == 200 and codes["reset"].isdigit()
    r = c.post("/reset-password", json={"email": "fp@test.com",
                                        "code": codes["reset"],
                                        "new_password": "newpass456"})
    assert r.status_code == 200
    assert c.post("/login", json={"email": "fp@test.com", "password": "pass12345"}).status_code == 401
    assert c.post("/login", json={"email": "fp@test.com", "password": "newpass456"}).status_code == 200
    # 重置吊销旧会话
    assert c.get("/me", headers=auth(sid)).status_code == 401


def test_reset_code_lock_and_expiry():
    c = make_client()
    register_and_verify(c, "rl@test.com")
    codes = {}
    def _send(_to, template, code):
        codes[template] = code
        return True
    with mock.patch.object(main, "send_email", _send):
        c.post("/forgot-password", json={"email": "rl@test.com"})
    for _ in range(5):
        r = c.post("/reset-password", json={"email": "rl@test.com", "code": "000000",
                                            "new_password": "newpass456"})
        assert r.status_code == 400
    assert c.post("/reset-password", json={"email": "rl@test.com", "code": codes["reset"],
                                           "new_password": "newpass456"}).status_code == 429


def test_verify_link_endpoint_removed():
    c = make_client()
    assert c.get("/verify", params={"token": "whatever"}).status_code == 404
```

- [ ] **Step 2: 确认失败**

Run: `.venv/bin/pytest test_billing.py -q -k "reset or verify_link"`
Expected: FAIL（`/reset-password` 仍收 `{token,...}`；`GET /verify` 仍 200）。

- [ ] **Step 3: 实现**

`_RESET_ATTEMPT_LIMITER = _SlidingWindowLimiter(5, 10 * 60)`。`ResetPasswordReq` 改为：

```python
class ResetPasswordReq(BaseModel):
    email: str = Field(..., max_length=254)
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=128)
```

`/forgot-password`：`reset_token = _mint_code()`，落库哈希与 10 分钟有效期不变，发 `reset` 模板。`/reset-password` 重写：锁定键=邮箱，按 `email` 查 `reset_token` 哈希比对 + `reset_expire` 校验（失败 `record` 并 400；锁定 429），成功则改密、清 token、吊销全部会话（原逻辑保留）、`clear` 计数。删除整个 `verify_email` 路由（`GET /verify`）。`send_email` 凭证检查与 `/health` 的 `mail_configured` 去掉 `APP_BASE_URL` 条件（`APP_BASE_URL` 变量本身保留给未来用途，不参与邮件判定）。

- [ ] **Step 4: 全绿**

Run: `.venv/bin/pytest test_billing.py -q`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add main.py test_billing.py
git commit -m "feat(billing): code-based password reset; drop link endpoints"
```

---

### Task 3: 幂等缓存表与助手函数

**Files:**

- Modify: `main.py`（`init_db` 建表；新增幂等助手）
- Test: `test_generate.py`（新建，本任务只测助手）

**Interfaces:**

- Produces:
  - 表 `idempotency_cache(user_id TEXT, request_id TEXT, status TEXT, result_json TEXT, created_at TEXT, PRIMARY KEY(user_id, request_id))`
  - `_IDEMPOTENCY_TTL_S = 600`
  - `_idempotency_get(uid: str, rid: str) -> tuple[str, str | None] | None` —— 返回 `(status, result_json)`；不存在/过期（过期行顺手删除）返回 None
  - `_idempotency_put_running(uid, rid) -> None`（`INSERT OR REPLACE` 置 `running`）
  - `_idempotency_done(uid, rid, result_json: str) -> None`
  - `_idempotency_fail(uid, rid) -> None`（删除行，允许同 id 重入）

- [ ] **Step 1: 写失败测试（新建 test_generate.py）**

```python
"""billing-backend /v1/generate 新契约测试。共享工具自 test_billing 导入。"""
import os
import sqlite3
import tempfile
import unittest.mock as mock

# 与 test_billing 相同的环境布置必须在 import main 前完成；
# 若 test_billing 已被导入（同一 pytest 会话），其环境变量已生效，直接复用。
try:
    from test_billing import (auth, db, fake_usage, make_client, recharge,
                              register_and_verify, COST_57_11, ADMIN)
except ImportError:  # 单独运行本文件时自举
    _DB = os.path.join(tempfile.mkdtemp(prefix="billing-gen-"), "usage.db")
    os.environ["BILLING_DB_PATH"] = _DB
    os.environ["ADMIN_TOKEN"] = "test-admin-token"
    os.environ["DEEPSEEK_API_KEY"] = "test-ds-key"
    os.environ["ALLOW_DEGRADED_MAIL"] = "1"
    os.environ.pop("API_TOKEN", None)
    raise SystemExit("请在同一会话与 test_billing 一起运行（pytest 会先收集它）")

import main  # noqa: E402


def test_idempotency_helpers_lifecycle():
    main.init_db()
    uid, rid = "u_idem", "r-1"
    assert main._idempotency_get(uid, rid) is None
    main._idempotency_put_running(uid, rid)
    assert main._idempotency_get(uid, rid) == ("running", None)
    main._idempotency_done(uid, rid, '{"text":"x"}')
    assert main._idempotency_get(uid, rid) == ("done", '{"text":"x"}')
    main._idempotency_fail(uid, rid)          # done 行也能被 fail 清除（失败/取消语义）
    assert main._idempotency_get(uid, rid) is None


def test_idempotency_ttl_expiry():
    main.init_db()
    uid, rid = "u_idem2", "r-2"
    main._idempotency_done(uid, rid, '{"text":"y"}')
    with db() as conn:  # 手工拨快时钟：把创建时间推到 TTL 之外
        conn.execute(
            "UPDATE idempotency_cache SET created_at='2000-01-01T00:00:00+00:00' "
            "WHERE user_id=? AND request_id=?", (uid, rid))
        conn.commit()
    assert main._idempotency_get(uid, rid) is None      # 过期视为不存在
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) FROM idempotency_cache WHERE user_id=?",
                         (uid,)).fetchone()[0]
    assert n == 0                                          # 过期行已清
```

- [ ] **Step 2: 确认失败**

Run: `.venv/bin/pytest test_generate.py -q`
Expected: FAIL（`_idempotency_get` 不存在 / 表不存在）。

- [ ] **Step 3: 实现**

`init_db` 里（`usage_log` 建表之后、seed 之前）：

```python
conn.execute("""
    CREATE TABLE IF NOT EXISTS idempotency_cache (
        user_id     TEXT NOT NULL,
        request_id  TEXT NOT NULL,
        status      TEXT NOT NULL,          -- running | done
        result_json TEXT,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (user_id, request_id)
    )
""")
```

助手（模块级，统一走 `_db_conn`）：

```python
_IDEMPOTENCY_TTL_S = 600

def _idempotency_cleanup(conn, now_iso: str) -> None:
    conn.execute(
        "DELETE FROM idempotency_cache WHERE created_at <= datetime(?, ?)",
        (now_iso, f"-{_IDEMPOTENCY_TTL_S} seconds"))

def _idempotency_get(uid: str, rid: str):
    now = _now_iso()
    with _db_conn() as conn:
        _idempotency_cleanup(conn, now)
        row = conn.execute(
            "SELECT status, result_json FROM idempotency_cache WHERE user_id=? AND request_id=?",
            (uid, rid)).fetchone()
        conn.commit()
    return (row["status"], row["result_json"]) if row is not None else None

def _idempotency_put_running(uid: str, rid: str) -> None:
    with _db_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO idempotency_cache (user_id, request_id, status, result_json, created_at) "
            "VALUES (?,?, 'running', NULL, ?)", (uid, rid, _now_iso()))
        conn.commit()

def _idempotency_done(uid: str, rid: str, result_json: str) -> None:
    with _db_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO idempotency_cache (user_id, request_id, status, result_json, created_at) "
            "VALUES (?,?, 'done', ?, ?)", (uid, rid, result_json, _now_iso()))
        conn.commit()

def _idempotency_fail(uid: str, rid: str) -> None:
    with _db_conn() as conn:
        conn.execute("DELETE FROM idempotency_cache WHERE user_id=? AND request_id=?", (uid, rid))
        conn.commit()
```

- [ ] **Step 4: 全绿**

Run: `.venv/bin/pytest test_billing.py test_generate.py -q`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add main.py test_generate.py
git commit -m "feat(billing): idempotency cache table and helpers"
```

---

### Task 4: GenerateReq 请求模型与校验

**Files:**

- Modify: `main.py`（新增 `GenerateReq`）
- Test: `test_generate.py`（pydantic 层校验测试）

**Interfaces:**

- Produces: `class GenerateReq(BaseModel)`，字段与约束见 Global Constraints（`request_id` `min_length=1, max_length=64`；`feature` `min_length=1, max_length=64`；`system_prompt` `min_length=1, max_length=4000`；`prompt` `min_length=1, max_length=20000`；`max_output_tokens: int = Field(4096, ge=1, le=8192)`）

- [ ] **Step 1: 写失败测试**

```python
import pydantic


def _gen_payload(**over):
    p = {"request_id": "r-x", "feature": "pageTranslation",
         "system_prompt": "sys", "prompt": "hello"}
    p.update(over)
    return p


def test_generate_req_limits():
    main.GenerateReq(**_gen_payload())                      # 合法
    main.GenerateReq(**_gen_payload(max_output_tokens=8192))
    for bad in [
        _gen_payload(request_id="x" * 65),
        _gen_payload(feature="x" * 65),
        _gen_payload(system_prompt="x" * 4001),
        _gen_payload(prompt="x" * 20001),
        _gen_payload(system_prompt=""),
        _gen_payload(prompt=""),
        _gen_payload(max_output_tokens=0),
        _gen_payload(max_output_tokens=8193),
    ]:
        try:
            main.GenerateReq(**bad)
        except pydantic.ValidationError:
            continue
        raise AssertionError(f"应拒绝: {[(k, len(str(v))) for k, v in bad.items()]}")
```

- [ ] **Step 2: 确认失败** → Expected: `AttributeError: module 'main' has no attribute 'GenerateReq'`

- [ ] **Step 3: 实现**（按 Interfaces 的精确约束写模型）

- [ ] **Step 4: 全绿** → `.venv/bin/pytest test_billing.py test_generate.py -q`

- [ ] **Step 5: Commit**

```bash
git add main.py test_generate.py
git commit -m "feat(billing): GenerateReq model with safety limits"
```

---

### Task 5: 上游流式调用器 `run_upstream_stream`

**Files:**

- Modify: `main.py`（新增 `UpstreamError`、`run_upstream_stream`；不动旧 `call_deepseek`，它在 Task 10 随 `/translate` 一起删）
- Test: `test_generate.py`

**Interfaces:**

- Produces:
  - `class UpstreamError(Exception)`
  - `def run_upstream_stream(system_prompt: str, prompt: str, max_output_tokens: int)` —— **阻塞生成器**（只在 `_DS_POOL` 线程运行）：`yield` 文本片段（str）；`return` usage dict（与旧 `call_deepseek` 的 usage 同形状：`prompt_tokens`/`completion_tokens`/`total_tokens`/`prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`）；上游异常/缺 usage 抛 `UpstreamError`。参数：`temperature=0.3`、`stream=True`、`stream_options={"include_usage": True}`、`timeout=60`。

- [ ] **Step 1: 写失败测试**

```python
class _FakeDelta:
    def __init__(self, content): self.content = content

class _FakeChoice:
    def __init__(self, content): self.delta = _FakeDelta(content)

class _FakeChunk:
    def __init__(self, content=None, usage=None):
        self.choices = [_FakeChoice(content)] if content is not None else []
        self.usage = usage

class _FakeUsage:
    def __init__(self):
        self.prompt_tokens, self.completion_tokens, self.total_tokens = 57, 11, 68
        self.prompt_cache_hit_tokens, self.prompt_cache_miss_tokens = 0, 57
        self.prompt_tokens_details = None

class _FakeStream:
    def __init__(self, chunks): self._chunks = chunks
    def __iter__(self): return iter(self._chunks)

class _FakeCompletions:
    def __init__(self, chunks, capture): self._chunks, self._capture = chunks, capture
    def create(self, **kw):
        self._capture.update(kw)
        return _FakeStream(self._chunks)

class _FakeChat:
    def __init__(self, chunks, capture): self.completions = _FakeCompletions(chunks, capture)

class _FakeClient:
    def __init__(self, chunks, capture): self.chat = _FakeChat(chunks, capture)


def _patch_openai(chunks):
    capture = {}
    fake = _FakeClient(chunks, capture)
    return mock.patch.object(main, "OpenAI", lambda **kw: fake), capture


def test_run_upstream_stream_yields_and_returns_usage():
    usage_chunk = _FakeChunk(usage=_FakeUsage())
    patches, cap = _patch_openai([_FakeChunk("Hel"), _FakeChunk("lo"), usage_chunk])
    with patches:
        gen = main.run_upstream_stream("SYS", "USER", 4096)
        got = list(gen)
    assert got == ["Hel", "lo"]
    try:
        next(gen)
    except StopIteration as e:
        usage = e.value
    assert usage["prompt_tokens"] == 57 and usage["completion_tokens"] == 11
    assert cap["stream"] is True
    assert cap["stream_options"] == {"include_usage": True}
    assert cap["max_tokens"] == 4096
    assert cap["messages"] == [{"role": "system", "content": "SYS"},
                               {"role": "user", "content": "USER"}]


def test_run_upstream_stream_error_and_missing_usage():
    class _BoomStream:
        def __iter__(self): raise RuntimeError("boom")
    class _BoomCompletions:
        def create(self, **kw): return _BoomStream()
    class _BoomClient:
        chat = _BoomCompletions()
    with mock.patch.object(main, "OpenAI", lambda **kw: _BoomClient()):
        gen = main.run_upstream_stream("s", "p", 4096)
        try:
            next(gen)
            raise AssertionError("应抛 UpstreamError")
        except main.UpstreamError as e:
            assert "boom" in str(e)
    patches, _ = _patch_openai([_FakeChunk("x")])   # 无 usage 块
    with patches:
        gen = main.run_upstream_stream("s", "p", 4096)
        list(gen)
        try:
            next(gen)
            raise AssertionError("缺 usage 应抛错")
        except main.UpstreamError as e:
            assert "usage" in str(e)
```

- [ ] **Step 2: 确认失败** → `AttributeError: ... 'run_upstream_stream'`

- [ ] **Step 3: 实现**

```python
class UpstreamError(Exception):
    """上游调用失败（错误摘要已截断 200 字符）。"""

def run_upstream_stream(system_prompt: str, prompt: str, max_output_tokens: int):
    """阻塞生成器（仅限 _DS_POOL 线程）：yield 文本片段，return usage。

    与旧 call_deepseek 同一上游契约：temperature=0.3、timeout=60；
    usage 取流末 include_usage 块，cache_hit/miss 提取逻辑与旧实现一致。
    """
    if not DEEPSEEK_API_KEY:
        raise UpstreamError("DEEPSEEK_API_KEY 未配置")
    try:
        client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
        stream = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=max_output_tokens,
            timeout=60,
            stream=True,
            stream_options={"include_usage": True},
        )
    except Exception as e:
        raise UpstreamError(str(e)[:200]) from e
    usage = None
    try:
        for chunk in stream:
            chunk_usage = getattr(chunk, "usage", None)
            if chunk_usage is not None:
                usage = chunk_usage
            if not getattr(chunk, "choices", None):
                continue
            piece = getattr(chunk.choices[0].delta, "content", None)
            if piece:
                yield piece
    except Exception as e:
        raise UpstreamError(str(e)[:200]) from e
    if usage is None:
        raise UpstreamError("响应缺少 usage 字段")
    cache_hit = 0
    details = getattr(usage, "prompt_tokens_details", None)
    if details is not None:
        cache_hit = getattr(details, "cached_tokens", 0) or 0
    if not cache_hit:
        cache_hit = getattr(usage, "prompt_cache_hit_tokens", 0) or 0
    cache_miss = getattr(usage, "prompt_cache_miss_tokens", None)
    if not cache_miss:
        cache_miss = (usage.prompt_tokens or 0) - cache_hit
    return {
        "prompt_tokens": usage.prompt_tokens or 0,
        "completion_tokens": usage.completion_tokens or 0,
        "total_tokens": usage.total_tokens or 0,
        "prompt_cache_hit_tokens": cache_hit,
        "prompt_cache_miss_tokens": cache_miss,
    }
```

- [ ] **Step 4: 全绿** → `.venv/bin/pytest test_billing.py test_generate.py -q`
- [ ] **Step 5: Commit**

```bash
git add main.py test_generate.py
git commit -m "feat(billing): streaming upstream runner run_upstream_stream"
```

---

### Task 6: `/v1/generate` 路由核心（闸门→SSE→结算）

**Files:**

- Modify: `main.py`（`/v1/generate` 路由、`_gate_balance`、`sse_event`、`_generate_worker`、`_replay_response` 的 done 事件组装、`usage_log` 加 `feature` 列、`charge_and_log`/`log_failed_call` 扩展签名、`queue`/`json` 导入）
- Test: `test_generate.py`

**Interfaces:**

- Consumes: Task 3 幂等助手（本任务只用 `_idempotency_put_running`，done/fail 由 worker 调）、Task 4 `GenerateReq`、Task 5 `run_upstream_stream`/`UpstreamError`；既有 `require_session`、`_DS_POOL`、`charge_and_log`、`log_failed_call`、`PricingError`、`fmt_yuan`
- Produces:
  - `_gate_balance(user_id: str) -> int`（工作线程；读 DB 新鲜余额，**并校验当前价格/服务费配置完备**——调用 `_get_prices(conn, MODEL)` 与 `_get_fee_config(conn)`，缺失抛 `PricingError`。这保留 F6 的 fail-closed：缺价必须在调上游**之前**返回 503，而不是先花上游成本再在结算时失败）
  - `_GEN_HEARTBEAT_S = 15.0`（SSE 心跳间隔；路由侧在队列空闲超过该时长时发送 `": keep-alive\n\n"` 注释行，防代理掐空闲连接）
  - `sse_event(event: str, data: str) -> str` → `f"event: {event}\ndata: {data}\n\n"`
  - `_generate_worker(uid, req, q, sem)`（阻塞；`_DS_POOL` 线程）：消费上游→`q.put(("delta"|"done"|"error", <json str>))`→结算→`_idempotency_done`/`_idempotency_fail`→`finally: sem.release()`；结尾 `q.put(None)` 哨兵
  - `charge_and_log(..., feature: str = "", audit_note: str | None = None)`（新参数有默认值，旧调用不受影响；`audit_note` 非空且全额结算时写入 error 列）
  - `log_failed_call(..., feature: str = "")`
  - `usage_log` 新列 `feature TEXT`（`init_db` 补列：`if "feature" not in cols: ALTER TABLE ...`）
  - SSE 事件形状：`delta`=`{"text": <str>}`；`done`=`{"usage": {...}, "cost": <元>, "latency_ms": <int>}`；`error`=`{"detail": <str>}`
  - 超时常量 `_GEN_FIRST_CHUNK_TIMEOUT_S = 60.0`、`_GEN_TOTAL_TIMEOUT_S = 120.0`

- [ ] **Step 1: 写失败测试**

（`test_generate.py` 顶部导入在本任务扩充为：`import json, os, threading, time`。）

```python
import json

SSE_DEFAULT = {"system_prompt": "You translate.", "prompt": "Translate: hi"}


def gen_req(**over):
    p = {"request_id": "rid-" + os.urandom(4).hex(), "feature": "pageTranslation",
         "max_output_tokens": 4096}
    p.update(SSE_DEFAULT)
    p.update(over)
    return p


def parse_sse(lines):
    events, cur = [], None
    for line in lines:
        if line.startswith("event:"):
            cur = line[len("event:"):].strip()
        elif line.startswith("data:"):
            events.append((cur, json.loads(line[len("data:"):].strip())))
    return events


def mock_stream(chunks=("Hel", "lo"), usage=None, raise_after=None, pull_log=None):
    def _run(sp, p, mot):
        for i, ch in enumerate(chunks):
            if raise_after is not None and i == raise_after:
                raise main.UpstreamError("mock upstream error")
            if pull_log is not None:
                pull_log.append(ch)
            yield ch
        return usage or fake_usage()
    return mock.patch.object(main, "run_upstream_stream", _run)


def _stream_generate(c, sid, payload):
    with c.stream("POST", "/v1/generate", headers=auth(sid), json=payload) as r:
        body = r.status_code, parse_sse(r.iter_lines()) if r.status_code == 200 else None
    return body


def test_generate_full_flow_sse_charges():
    c = make_client()
    sid, uid = register_and_verify(c, "g1@test.com")
    recharge(c, uid, 10.0)
    payload = gen_req(request_id="g1-r1")
    with mock_stream(chunks=("Hel", "lo"), usage=fake_usage(57, 11)):
        code, events = _stream_generate(c, sid, payload)
    assert code == 200
    text = "".join(d["text"] for ev, d in events if ev == "delta")
    assert text == "Hello"
    done = [d for ev, d in events if ev == "done"][0]
    assert done["cost"] == round(COST_57_11 / 1e8, 8)
    with db() as conn:
        bal = conn.execute("SELECT balance FROM users WHERE user_id=?", (uid,)).fetchone()[0]
        row = conn.execute("SELECT feature, source_text, ok, cost, model_cost, service_fee "
                           "FROM usage_log WHERE user_id=?", (uid,)).fetchone()
    assert bal == 1_000_000_000 - COST_57_11
    assert (row["ok"], row["cost"], row["model_cost"] + row["service_fee"]) == \
        (1, COST_57_11, COST_57_11)
    assert row["feature"] == "pageTranslation"
    assert row["source_text"] == payload["prompt"]


def test_generate_zero_balance_402_no_upstream():
    c = make_client()
    sid, _ = register_and_verify(c, "g2@test.com")
    calls = []
    def _run(sp, p, mot):
        calls.append(1)
        yield "x"
        return fake_usage()
    with mock.patch.object(main, "run_upstream_stream", _run):
        r = c.post("/v1/generate", headers=auth(sid), json=gen_req())
    assert r.status_code == 402 and not calls


def test_generate_tiny_balance_partial_settle_delivers():
    c = make_client()
    sid, uid = register_and_verify(c, "g3@test.com")
    recharge(c, uid, 0.001)                       # 100000（1e-8 元）
    over = fake_usage(prompt=64, completion=4096)  # 应收远超余额
    with mock_stream(chunks=("Hello",), usage=over):
        code, events = _stream_generate(c, sid, gen_req(request_id="g3-r1"))
    assert code == 200
    assert "".join(d["text"] for ev, d in events if ev == "delta") == "Hello"
    with db() as conn:
        u = conn.execute("SELECT balance, total_spent FROM users WHERE user_id=?",
                         (uid,)).fetchone()
        row = conn.execute("SELECT ok, cost, model_cost, service_fee, error FROM usage_log "
                           "WHERE user_id=?", (uid,)).fetchone()
    assert u["balance"] == 0 and u["total_spent"] == 100000
    assert row["ok"] == 1 and row["cost"] == 100000
    assert row["model_cost"] + row["service_fee"] == row["cost"]
    assert row["error"].startswith("settle_partial:")


def test_generate_upstream_error_no_charge():
    c = make_client()
    sid, uid = register_and_verify(c, "g4@test.com")
    recharge(c, uid, 5.0)
    with mock_stream(raise_after=0):
        code, events = _stream_generate(c, sid, gen_req(request_id="g4-r1"))
    assert code == 200                            # SSE 层成功，流内报错
    err = [d for ev, d in events if ev == "error"]
    assert err and "mock upstream error" in err[0]["detail"]
    with db() as conn:
        u = conn.execute("SELECT balance, total_spent FROM users WHERE user_id=?",
                         (uid,)).fetchone()
        row = conn.execute("SELECT ok, cost, error, feature FROM usage_log WHERE user_id=?",
                           (uid,)).fetchone()
    assert u["balance"] == 500_000_000 and u["total_spent"] == 0
    assert row["ok"] == 0 and row["cost"] == 0 and "mock upstream error" in row["error"]
    assert row["feature"] == "pageTranslation"


def test_generate_oversize_fields_422():
    c = make_client()
    sid, _ = register_and_verify(c, "g5@test.com")
    recharge(c, _, 10.0)
    for bad in [gen_req(system_prompt="x" * 4001), gen_req(prompt="x" * 20001),
                gen_req(request_id="x" * 65), gen_req(max_output_tokens=8193)]:
        assert c.post("/v1/generate", headers=auth(sid), json=bad).status_code == 422


def test_generate_unverified_email_403():
    c = make_client()
    codes = {}
    with mock.patch.object(main, "send_email",
                           lambda _t, tpl, code: codes.setdefault(tpl, code) or True):
        r = c.post("/register", json={"email": "g6@test.com", "password": "pass12345"})
    r = c.post("/login", json={"email": "g6@test.com", "password": "pass12345"})
    assert r.status_code == 403                   # 未验证不能登录 → 换路：直接造会话
    # 用 seed 方式造一个未验证但持会话的用户
    import secrets as _s
    from datetime import datetime, timezone, timedelta
    uid = "u_unv_" + _s.token_hex(4)
    sidv = "sid-unv-" + _s.token_urlsafe(8)
    now = main._now_iso()
    with db() as conn:
        conn.execute("INSERT INTO users (user_id,email,password_hash,balance,email_verified,"
                     "status,created_at,updated_at) VALUES (?,?,?,100000000,0,'active',?,?)",
                     (uid, "g6b@test.com", "x", now, now))
        conn.execute("INSERT INTO sessions (session_id,user_id,created_at,expire_at,revoked) "
                     "VALUES (?,?,?, '2999-01-01T00:00:00+00:00', 0)",
                     (main._tok_digest(sidv), uid, now))
        conn.commit()
    assert c.post("/v1/generate", headers=auth(sidv), json=gen_req()).status_code == 403


def test_generate_gate_reads_fresh_db_balance_not_auth_time():
    """接线钉：鉴权后、闸门前余额被扣到 0 → 必须 402 且零上游调用。
    突变体：路由改读鉴权时刻 user 行余额 → 放行 → 本测试红。"""
    import asyncio, httpx
    c = make_client()
    sid, uid = register_and_verify(c, "g7@test.com")
    recharge(c, uid, 1.0)
    calls = []
    def _run(sp, p, mot):
        calls.append(1)
        yield "x"
        return fake_usage()
    orig = main._gate_balance
    def gate_zero_then_read(uid_):
        with db() as conn:
            conn.execute("UPDATE users SET balance=0 WHERE user_id=?", (uid_,))
            conn.commit()
        return orig(uid_)
    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            with mock.patch.object(main, "run_upstream_stream", _run), \
                 mock.patch.object(main, "_gate_balance", gate_zero_then_read):
                r = await ac.post("/v1/generate", headers=auth(sid), json=gen_req())
            return r
    r = asyncio.run(scenario())
    assert r.status_code == 402 and not calls


def test_generate_heartbeat_when_idle():
    """规格 §3.3：流中空闲超过心跳间隔 → 发 ': keep-alive' 注释行（间隔可 patch）。"""
    c = make_client()
    sid, uid = register_and_verify(c, "gh@test.com")
    recharge(c, uid, 10.0)
    def _run(sp, p, mot):
        time.sleep(0.3)
        yield "ok"
        return fake_usage(57, 11)
    with mock.patch.object(main, "run_upstream_stream", _run), \
         mock.patch.object(main, "_GEN_HEARTBEAT_S", 0.05):
        with c.stream("POST", "/v1/generate", headers=auth(sid), json=gen_req()) as r:
            lines = list(r.iter_lines())
    assert any(line.startswith(": keep-alive") for line in lines)
    assert any(line.startswith("event: done") for line in lines)
```

- [ ] **Step 2: 确认失败** → `/v1/generate` 404。

- [ ] **Step 3: 实现**

`main.py` 顶部补 `import json`、`import queue`。`usage_log` 补 `feature TEXT` 列（`init_db` 的补列块追加 `if "feature" not in cols: conn.execute("ALTER TABLE usage_log ADD COLUMN feature TEXT")`）。`charge_and_log` 与 `log_failed_call` 的 INSERT 列表各加 `feature`，签名加默认参数；`charge_and_log` 全额结算分支在 `audit_note` 非空时把它写入 error 列（部分结算分支的 `settle_partial:` 串优先，`audit_note` 追加其后以 `|` 分隔亦可——实现时用 `audit = audit or audit_note` 语义保持单一来源）。

```python
_GEN_FIRST_CHUNK_TIMEOUT_S = 60.0
_GEN_TOTAL_TIMEOUT_S = 120.0
_GEN_HEARTBEAT_S = 15.0

def _gate_balance(user_id: str) -> int:
    """闸门：DB 新鲜余额 + 计费配置完备性校验（工作线程执行）。

    缺价/缺服务费配置抛 PricingError——F6 fail-closed：必须在调上游之前 503，
    绝不能先花上游成本再在结算阶段失败。
    """
    with _db_conn() as conn:
        _get_prices(conn, MODEL)
        _get_fee_config(conn)
        row = conn.execute("SELECT balance FROM users WHERE user_id=?", (user_id,)).fetchone()
    return row["balance"] if row is not None else 0

def sse_event(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"

def _generate_worker(uid: str, req: "GenerateReq", q: "queue.Queue", sem) -> None:
    """阻塞工作线程：消费上游流 → SSE 入队 → 结算 → 幂等落终态。
    客户端掉线不影响本线程——结算完成才释放信号量（防逃单/防超卖）。"""
    started = time.perf_counter()
    ts = _now_iso()
    acc: list[str] = []
    def _emit(kind: str, payload: dict) -> None:
        q.put((kind, json.dumps(payload, ensure_ascii=False)))
    try:
        gen = run_upstream_stream(req.system_prompt, req.prompt, req.max_output_tokens)
        first_deadline = time.monotonic() + _GEN_FIRST_CHUNK_TIMEOUT_S
        total_deadline = time.monotonic() + _GEN_TOTAL_TIMEOUT_S
        while True:
            if _flag_cancelled(uid, req.request_id):          # Task 9 提供
                gen.close()
                usage = _heuristic_usage(req.system_prompt, req.prompt, "".join(acc))
                cost = charge_and_log(uid, MODEL, usage, req.prompt[:4000], "".join(acc),
                                      int((time.perf_counter() - started) * 1000), ts,
                                      feature=req.feature,
                                      audit_note=f"cancelled:chunks={len(acc)}")
                _idempotency_fail(uid, req.request_id)
                _emit("error", {"detail": "cancelled"})
                return
            now_m = time.monotonic()
            if (not acc and now_m > first_deadline) or now_m > total_deadline:
                raise TimeoutError("gen_timeout")
            try:
                piece = next(gen)
            except StopIteration as stop:
                usage = stop.value
                break
            acc.append(piece)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        full_text = "".join(acc)
        cost = charge_and_log(uid, MODEL, usage, req.prompt[:4000], full_text,
                              elapsed_ms, ts, feature=req.feature)
        _idempotency_done(uid, req.request_id, json.dumps(
            {"text": full_text, "usage": usage, "cost_minor": cost,
             "latency_ms": elapsed_ms}, ensure_ascii=False))
        _emit("done", {"usage": usage, "cost": fmt_yuan(cost, 8), "latency_ms": elapsed_ms})
    except PricingError as e:
        log_failed_call(uid, MODEL, f"billing_config_missing: {e}", req.prompt[:4000],
                        int((time.perf_counter() - started) * 1000), feature=req.feature)
        _idempotency_fail(uid, req.request_id)
        _emit("error", {"detail": f"计费配置缺失: {e}"})
    except (UpstreamError, TimeoutError) as e:
        log_failed_call(uid, MODEL, str(e)[:200], req.prompt[:4000],
                        int((time.perf_counter() - started) * 1000), feature=req.feature)
        _idempotency_fail(uid, req.request_id)
        _emit("error", {"detail": f"上游调用失败: {e}"})
    except Exception as e:  # F9 精神：结算异常留审计再结构化报错
        print(f"[generate:worker-error] user={uid} error={str(e)[:200]}")
        log_failed_call(uid, MODEL, f"settle_error:{str(e)[:150]}", req.prompt[:4000],
                        int((time.perf_counter() - started) * 1000), feature=req.feature)
        _idempotency_fail(uid, req.request_id)
        _emit("error", {"detail": "结算失败，已记录审计日志，请联系管理员"})
    finally:
        q.put(None)
        sem.release()
```

取消基础设施分两步：本任务在模块级落地 `_CANCEL_FLAGS: dict[tuple[str, str], bool] = {}`、`_CANCEL_LOCK = threading.Lock()`、`_flag_cancelled(uid, rid)`（查表，缺省 False）与 `_set_cancelled(uid, rid)`（置 True）——此时没有任何端点调用 `_set_cancelled`，所以行为是"永不取消"，保证本任务可独立编译运行；Task 9 新增 `/v1/cancel` 端点接入 `_set_cancelled` 并补齐取消结算路径与测试。`_heuristic_usage` 在 Task 9 定义（本任务代码引用它的分支在没有取消发生时不会执行，但仍需 Task 9 之前先写好该函数的最小实现：与 Task 9 的正式实现逐字一致，直接照抄）。

路由：

```python
@app.post("/v1/generate")
async def generate(req: GenerateReq, user: sqlite3.Row = Depends(require_session)):
    if not user["email_verified"]:
        raise HTTPException(status_code=403, detail="邮箱未验证，禁止调用")
    uid = user["user_id"]
    hit = _idempotency_get(uid, req.request_id)
    if hit is not None:
        status, result_json = hit
        if status == "running":
            raise HTTPException(status_code=409, detail="相同 request_id 的请求正在处理")
        return _replay_response(result_json)
    sem = _TRANSLATE_INFLIGHT.get(uid)
    if sem is None:
        sem = asyncio.Semaphore(_TRANSLATE_INFLIGHT_LIMIT)
        _TRANSLATE_INFLIGHT[uid] = sem
    if sem.locked():
        raise HTTPException(status_code=429, detail="已有请求正在处理，请稍后再试")
    await sem.acquire()
    loop = asyncio.get_running_loop()
    try:
        balance = await loop.run_in_executor(_DS_POOL, _gate_balance, uid)
    except PricingError as e:
        sem.release()
        raise HTTPException(status_code=503, detail=f"计费配置缺失: {e}")
    if balance <= 0:
        sem.release()
        raise HTTPException(status_code=402,
                            detail="余额不足（当前 0 元），请充值")
    _idempotency_put_running(uid, req.request_id)
    q: queue.Queue = queue.Queue()
    loop.run_in_executor(_DS_POOL, _generate_worker, uid, req, q, sem)
    async def sse_gen():
        while True:
            try:
                item = await loop.run_in_executor(
                    None, lambda: q.get(timeout=_GEN_HEARTBEAT_S))
            except queue.Empty:
                yield ": keep-alive\n\n"     # SSE 注释行，客户端忽略，防代理掐连接
                continue
            if item is None:
                break
            kind, payload = item
            yield sse_event(kind, payload)
    return StreamingResponse(sse_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
```

（`from fastapi.responses import StreamingResponse`。）

`_replay_response(result_json: str)`：

```python
def _replay_response(result_json: str):
    r = json.loads(result_json)
    body = (sse_event("delta", json.dumps({"text": r["text"]}, ensure_ascii=False))
            + sse_event("done", json.dumps(
                {"usage": r["usage"], "cost": fmt_yuan(r["cost_minor"], 8),
                 "latency_ms": r["latency_ms"]}, ensure_ascii=False)))
    return StreamingResponse(iter([body]), media_type="text/event-stream")
```

- [ ] **Step 4: 全绿** → `.venv/bin/pytest test_billing.py test_generate.py -q`（既有 28 项不得变红）
- [ ] **Step 5: Commit**

```bash
git add main.py test_generate.py
git commit -m "feat(billing): /v1/generate SSE endpoint with balance gate and settlement"
```

---

### Task 7: 掉线保护钉（客户端中断仍结算）

**Files:**

- Test: `test_generate.py`

**Interfaces:**

- Consumes: Task 6 全部（`_generate_worker` 独立于连接存活的语义）

- [ ] **Step 1: 写失败测试**（验证既有实现已满足；若红则说明 Task 6 的线程结构有缺陷，必须修 Task 6 而不是改测试）

```python
def test_client_disconnect_still_settles_no_free_ride():
    """掉线钉：客户端读了首块即断开；上游继续被消费完，结算照扣，无免费交付。"""
    import asyncio, httpx
    c = make_client()
    sid, uid = register_and_verify(c, "gd@test.com")
    recharge(c, uid, 10.0)
    pull = []
    def _run(sp, p, mot):
        for ch in ("A", "B", "C"):
            pull.append(ch)
            time.sleep(0.05)
            yield ch
        return fake_usage(57, 11)
    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            with mock.patch.object(main, "run_upstream_stream", _run):
                async with ac.stream("POST", "/v1/generate", headers=auth(sid),
                                     json=gen_req(request_id="gd-r1")) as r:
                    it = r.aiter_lines()
                    await it.__anext__()          # 读一小段即断
            return None
    asyncio.run(scenario())
    deadline = time.perf_counter() + 5
    while pull != ["A", "B", "C"] and time.perf_counter() < deadline:
        time.sleep(0.02)                          # 等后台线程消费完
    assert pull == ["A", "B", "C"]
    with db() as conn:
        u = conn.execute("SELECT balance, total_spent FROM users WHERE user_id=?",
                         (uid,)).fetchone()
        row = conn.execute("SELECT ok, cost FROM usage_log WHERE user_id=?",
                           (uid,)).fetchone()
    assert row["ok"] == 1 and row["cost"] == COST_57_11
    assert u["balance"] == 1_000_000_000 - COST_57_11 and u["total_spent"] == COST_57_11
```

- [ ] **Step 2: 跑** → Expected: PASS（Task 6 的线程结构天然满足；若 FAIL 修 Task 6 的 worker 生命周期）。
- [ ] **Step 3: Commit**

```bash
git add test_generate.py
git commit -m "test(billing): pin settlement after client disconnect"
```

---

### Task 8: 幂等路由语义钉（重放/在途 409/失败重入）

**Files:**

- Test: `test_generate.py`（可能微调 Task 6 代码——若测试红了，修实现）

**Interfaces:**

- Consumes: Task 3 助手、Task 6 路由

- [ ] **Step 1: 写失败测试**

```python
def test_idempotent_replay_no_double_charge():
    c = make_client()
    sid, uid = register_and_verify(c, "gi@test.com")
    recharge(c, uid, 10.0)
    payload = gen_req(request_id="gi-r1")
    with mock_stream(usage=fake_usage(57, 11)):
        code1, ev1 = _stream_generate(c, sid, payload)
        code2, ev2 = _stream_generate(c, sid, payload)   # 重放：不碰上游（mock 已退出也能回放）
    assert code1 == code2 == 200
    t1 = "".join(d["text"] for ev, d in ev1 if ev == "delta")
    t2 = "".join(d["text"] for ev, d in ev2 if ev == "delta")
    assert t1 == t2 == "Hello"
    d1 = [d for ev, d in ev1 if ev == "done"][0]
    d2 = [d for ev, d in ev2 if ev == "done"][0]
    assert d1["cost"] == d2["cost"] == round(COST_57_11 / 1e8, 8)
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) FROM usage_log WHERE user_id=? AND ok=1",
                         (uid,)).fetchone()[0]
        bal = conn.execute("SELECT balance FROM users WHERE user_id=?", (uid,)).fetchone()[0]
    assert n == 1 and bal == 1_000_000_000 - COST_57_11


def test_inflight_same_request_id_409_then_replay():
    import asyncio, httpx
    c = make_client()
    sid, uid = register_and_verify(c, "gj@test.com")
    recharge(c, uid, 10.0)
    payload = gen_req(request_id="gj-r1")
    release = threading.Event()
    def _run(sp, p, mot):
        yield "A"
        release.wait(3.0)
        yield "B"
        return fake_usage(57, 11)
    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            with mock.patch.object(main, "run_upstream_stream", _run):
                t1 = asyncio.ensure_future(_consume(ac, sid, payload))
                await asyncio.sleep(0.15)                # A 已在途
                r2 = await ac.post("/v1/generate", headers=auth(sid), json=payload)
                release.set()
                ev1 = await t1
            return r2.status_code, ev1
    async def _consume(ac, sid_, payload_):
        async with ac.stream("POST", "/v1/generate", headers=auth(sid_),
                             json=payload_) as r:
            return [line async for line in r.aiter_lines()]
    code2, _ = asyncio.run(scenario())
    assert code2 == 409
    # 完成后可重放
    code3, ev3 = _stream_generate(c, sid, payload)
    assert code3 == 200 and any(ev == "done" for ev, _ in ev3)


def test_failed_id_allows_fresh_retry():
    c = make_client()
    sid, uid = register_and_verify(c, "gk@test.com")
    recharge(c, uid, 10.0)
    payload = gen_req(request_id="gk-r1")
    with mock_stream(raise_after=0):                     # 第一次失败
        code1, _ = _stream_generate(c, sid, payload)
    assert code1 == 200                                  # 流内 error 事件
    with mock_stream(usage=fake_usage(57, 11)):          # 同 id 重入成功
        code2, ev2 = _stream_generate(c, sid, payload)
    assert code2 == 200 and any(ev == "done" for ev, _ in ev2)
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) FROM usage_log WHERE user_id=? AND ok=1",
                         (uid,)).fetchone()[0]
    assert n == 1
```

（`import threading` 已在 test_billing 中；test_generate 顶部补 `import threading, time`。）

- [ ] **Step 2: 跑** → 红则修 Task 6 的幂等接线（重点：`_idempotency_done` 是否在结算后、409 检查是否在信号量前）。
- [ ] **Step 3: 全绿** → `.venv/bin/pytest test_billing.py test_generate.py -q`
- [ ] **Step 4: Commit**

```bash
git add main.py test_generate.py
git commit -m "test(billing): idempotency route semantics (replay/409/fresh-retry)"
```

---

### Task 9: `/v1/cancel`（掐上游 + 启发式结算）

**Files:**

- Modify: `main.py`（`CancelReq`、`_CANCEL_FLAGS`/`_CANCEL_LOCK`、`_flag_cancelled`/`_set_cancelled` 实际行为、`_heuristic_usage`、`POST /v1/cancel`；Task 6 留的临时 `_flag_cancelled` 替换为真实现）
- Test: `test_generate.py`

**Interfaces:**

- Produces:
  - `class CancelReq(BaseModel): request_id: str = Field(..., min_length=1, max_length=64)`
  - `_heuristic_usage(system_prompt, prompt, acc_text) -> dict` —— `prompt_tokens = (len(sp)+len(p))//2 + 8`；`completion_tokens = max(1, (len(acc)+1)//2)`；cache_hit=0、cache_miss=prompt_tokens、total=和。上界启发式（2 token/字，旧估算口径），取消路径专用；正常路径永远用真实 usage
  - `POST /v1/cancel {request_id}`：Bearer 鉴权；只登记 `(uid, request_id)` 标志；恒返回 200 `{"message": "ok"}`（无在途单即无副作用）
- 审计串：取消结算行 `error` 列前缀 `cancelled:chunks=<已收块数>`（经 `audit_note`）；`/me` 脱敏映射 `_AUDIT_ERROR_USER_MSG` 追加 `("cancelled:", "翻译已取消，已按生成部分结算")`

- [ ] **Step 1: 写失败测试**

```python
def test_cancel_stops_upstream_and_settles_consumed():
    import asyncio, httpx
    c = make_client()
    sid, uid = register_and_verify(c, "gc@test.com")
    recharge(c, uid, 10.0)
    payload = gen_req(request_id="gc-r1")
    pull = []
    def _run(sp, p, mot):
        for i in range(200):
            pull.append(i)
            time.sleep(0.01)
            yield f"c{i} "
        return fake_usage()
    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            with mock.patch.object(main, "run_upstream_stream", _run):
                t1 = asyncio.ensure_future(_drain(ac, sid, payload))
                await asyncio.sleep(0.15)
                rc = await ac.post("/v1/cancel", headers=auth(sid),
                                   json={"request_id": "gc-r1"})
                events = await t1
            return rc.status_code, events
    async def _drain(ac, sid_, payload_):
        async with ac.stream("POST", "/v1/generate", headers=auth(sid_),
                             json=payload_) as r:
            return parse_sse([line async for line in r.aiter_lines()])
    code_c, events = asyncio.run(scenario())
    assert code_c == 200
    assert any(ev == "error" and d["detail"] == "cancelled" for ev, d in events)
    deadline = time.perf_counter() + 3
    while len(pull) < 1 and time.perf_counter() < deadline:
        time.sleep(0.01)
    assert len(pull) < 100, f"上游未被及时掐断：已拉 {len(pull)} 块"
    with db() as conn:
        row = conn.execute("SELECT ok, cost, error FROM usage_log WHERE user_id=?",
                           (uid,)).fetchone()
    assert row["ok"] == 1 and row["cost"] > 0
    assert row["error"].startswith("cancelled:chunks=")
    # 取消后同 id 可重入（幂等行已删）
    with mock_stream(usage=fake_usage(57, 11)):
        code2, ev2 = _stream_generate(c, sid, payload)
    assert code2 == 200 and any(ev == "done" for ev, _ in ev2)


def test_cancel_scoped_to_own_session_and_noop():
    c = make_client()
    sid_a, uid_a = register_and_verify(c, "ga1@test.com")
    sid_b, _ = register_and_verify(c, "gb1@test.com")
    # 无在途单 → 200 无副作用
    assert c.post("/v1/cancel", headers=auth(sid_a),
                  json={"request_id": "nope"}).status_code == 200
    # 未鉴权 → 401
    assert c.post("/v1/cancel", json={"request_id": "x"}).status_code == 401
    # B 的取消不影响 A 的标志空间（白盒：直接查标志表）
    main._set_cancelled(uid_a, "only-a")
    assert main._flag_cancelled(uid_a, "only-a") is True
    assert main._flag_cancelled("u_other", "only-a") is False


def test_heuristic_usage_upper_bound_shape():
    u = main._heuristic_usage("ab", "cd" * 10, "xyz")
    assert u["prompt_tokens"] == (2 + 20) // 2 + 8
    assert u["completion_tokens"] == (3 + 1) // 2
    assert u["total_tokens"] == u["prompt_tokens"] + u["completion_tokens"]
    assert u["prompt_cache_hit_tokens"] == 0
    u0 = main._heuristic_usage("", "", "")
    assert u0["completion_tokens"] >= 1
```

- [ ] **Step 2: 确认失败** → `/v1/cancel` 404 / `_heuristic_usage` 不存在。
- [ ] **Step 3: 实现**

```python
_CANCEL_FLAGS: dict[tuple[str, str], bool] = {}
_CANCEL_LOCK = threading.Lock()

def _set_cancelled(uid: str, rid: str) -> None:
    with _CANCEL_LOCK:
        _CANCEL_FLAGS[(uid, rid)] = True

def _flag_cancelled(uid: str, rid: str) -> bool:
    with _CANCEL_LOCK:
        return _CANCEL_FLAGS.get((uid, rid), False)

def _clear_cancel(uid: str, rid: str) -> None:
    with _CANCEL_LOCK:
        _CANCEL_FLAGS.pop((uid, rid), None)

def _heuristic_usage(system_prompt: str, prompt: str, acc_text: str) -> dict[str, int]:
    """取消路径的上界启发式 usage（2 token/字，旧估算口径）：只可能高估、不会低估，
    杜绝取消逃单；正常路径永远使用上游真实 usage。"""
    pt = (len(system_prompt) + len(prompt)) // 2 + 8
    ct = max(1, (len(acc_text) + 1) // 2)
    return {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct,
            "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": pt}

class CancelReq(BaseModel):
    request_id: str = Field(..., min_length=1, max_length=64)

@app.post("/v1/cancel")
def cancel(req: CancelReq, user: sqlite3.Row = Depends(require_session)):
    _set_cancelled(user["user_id"], req.request_id)
    return {"message": "ok"}
```

`_generate_worker` 的 `finally` 里补 `_clear_cancel(uid, req.request_id)`。`_AUDIT_ERROR_USER_MSG` 追加 `("cancelled:", "翻译已取消，已按生成部分结算")`。

- [ ] **Step 4: 全绿** → `.venv/bin/pytest test_billing.py test_generate.py -q`
- [ ] **Step 5: Commit**

```bash
git add main.py test_generate.py
git commit -m "feat(billing): /v1/cancel stops upstream and settles consumed tokens"
```

---

### Task 10: 退役旧契约 + 并发/负载钉移植 + 文档

**Files:**

- Modify: `main.py`（删除 `/translate`、`TranslateReq`、`SYSTEM_PROMPT`、`build_user_prompt`、`estimate_max_cost`、`_gate_snapshot`、`call_deepseek`；`_TRANSLATE_INFLIGHT` 改名可选——保留名字即可，注释更新）
- Modify: `test_billing.py`（删除/移植依赖旧契约的用例）
- Test: `test_generate.py`（移植并发与负载钉子）
- Modify: `README.md`

**Interfaces:**

- Consumes: 全部前置任务
- Produces: 单一契约（`/v1/generate` + `/v1/cancel`）的完整回归套件；文档与代码一致

- [ ] **Step 1: 移植钉子（先写，证明新契约承担旧不变量）**

`test_generate.py` 追加（从旧 `test_billing.py` 移植改写；`estimate` 概念不存在了，按新闸门语义）：

```python
def test_generate_inflight_cap_no_free_ride():
    """F20 移植：余额=单次真实成本，10 路并发 → 至多 1 次真实上游调用，
    其余 429（在途）或 402（余额归零后）；余额归零不为负；无零付款交付。"""
    import asyncio, httpx
    from test_billing import seed_verified_user
    c = make_client()
    sid, uid = seed_verified_user("grace@test.com")
    cost = COST_57_11
    recharge(c, uid, cost / 1e8)
    ds_calls = []
    def _run(sp, p, mot):
        ds_calls.append(1)
        time.sleep(0.05)
        yield "Hello"
        return fake_usage(57, 11)
    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            with mock.patch.object(main, "run_upstream_stream", _run):
                rs = await asyncio.gather(*[
                    ac.post("/v1/generate", headers=auth(sid),
                            json=gen_req(request_id=f"race-{i}"))
                    for i in range(10)])
            return [r.status_code for r in rs]
    codes = asyncio.run(scenario())
    assert set(codes) <= {200, 402, 429}
    assert codes.count(200) == 1 and len(ds_calls) == 1
    with db() as conn:
        u = conn.execute("SELECT balance, total_spent FROM users WHERE user_id=?",
                         (uid,)).fetchone()
        paid = conn.execute("SELECT IFNULL(SUM(cost),0) s FROM usage_log "
                            "WHERE user_id=? AND ok=1", (uid,)).fetchone()["s"]
    assert u["balance"] == 0 and u["total_spent"] == paid == cost


def test_generate_random_costs_never_negative_no_free_delivery():
    """F30 移植：随机成本、余额恰覆盖前 5 次 → 恰好 5 次交付、其余 402、账目精确。"""
    import random
    from decimal import Decimal as D
    rng = random.Random(20260826)
    c = make_client()
    sid, uid = register_and_verify(c, "gv@test.com")
    prices = {"cache_hit": D("0.00000014"), "cache_miss": D("0.000001"),
              "completion": D("0.000002")}
    usages, costs = [], []
    for _ in range(12):
        p, comp = rng.randint(40, 164), rng.randint(40, 68)
        usage = fake_usage(p, comp)
        _, _, cost = main._compute_costs(usage, prices, D("0.2"), D("0.01"))
        usages.append(usage)
        costs.append(cost)
    recharge(c, uid, sum(costs[:5]) / 1e8)
    codes = []
    for i, usage in enumerate(usages):
        with mock_stream(usage=usage):
            code, _ = _stream_generate(c, sid, gen_req(request_id=f"gv-{i}"))
        codes.append(code)
    assert codes[:5] == [200] * 5 and set(codes[5:]) == {402}
    with db() as conn:
        u = conn.execute("SELECT balance, total_spent FROM users WHERE user_id=?",
                         (uid,)).fetchone()
        s = conn.execute("SELECT SUM(cost) s FROM usage_log WHERE user_id=? AND ok=1",
                         (uid,)).fetchone()["s"]
    assert u["balance"] == 0 and u["total_spent"] == s == sum(costs[:5])


def test_generate_gate_ordering_second_request_blocked_before_gate():
    """F50 排序钉移植：第二路在信号量处 429，未跑闸门（闸门计数=1）。"""
    import asyncio, httpx
    from test_billing import seed_verified_user
    c = make_client()
    sid, uid = seed_verified_user("go@test.com", balance_minor=1_000_000_000)
    gate_count = {"n": 0}
    release = threading.Event()
    orig = main._gate_balance
    def counting(uid_):
        gate_count["n"] += 1
        return orig(uid_)
    def _run(sp, p, mot):
        yield "A"
        release.wait(2.0)
        return fake_usage(57, 11)
    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            with mock.patch.object(main, "run_upstream_stream", _run), \
                 mock.patch.object(main, "_gate_balance", counting):
                futs = [asyncio.ensure_future(
                    ac.post("/v1/generate", headers=auth(sid),
                            json=gen_req(request_id=f"ord-{i}"))) for i in range(2)]
                await asyncio.sleep(0.2)
                release.set()
                rs = await asyncio.gather(*futs)
            return [r.status_code for r in rs]
    codes = asyncio.run(scenario())
    assert codes.count(429) >= 1 and gate_count["n"] == 1


def test_health_responsive_under_generate_load():
    """F15 移植：50 个慢 /v1/generate 在途，/health 仍及时返回。"""
    import asyncio, httpx
    from test_billing import seed_verified_user
    users = [seed_verified_user(f"hg{i}@test.com", balance_minor=10_000_000_000)
             for i in range(50)]
    def _run(sp, p, mot):
        time.sleep(0.3)
        yield "Hello"
        return fake_usage()
    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            with mock.patch.object(main, "run_upstream_stream", _run):
                tasks = [asyncio.create_task(
                    ac.post("/v1/generate", headers=auth(sid),
                            json=gen_req(request_id=f"hl-{i}")))
                    for i, (sid, _) in enumerate(users)]
                await asyncio.sleep(0.05)
                t0 = time.perf_counter()
                r = await ac.get("/health")
                dt = time.perf_counter() - t0
                rs = await asyncio.gather(*tasks)
            return r.status_code, dt, [x.status_code for x in rs]
    code, dt, codes = asyncio.run(scenario())
    assert code == 200 and dt < 0.3
    assert all(x == 200 for x in codes)


def test_event_loop_free_when_audit_writes_blocked_on_generate():
    """F22 移植：写锁阻塞审计写，50 路失败 /v1/generate 全被挡时 /health 仍及时。"""
    import asyncio, httpx
    from test_billing import seed_verified_user
    users = [seed_verified_user(f"aw{i}@test.com", balance_minor=1_000_000_000)
             for i in range(50)]
    lock_acquired = threading.Event()
    def hold_lock():
        lock = sqlite3.connect(main.DB_PATH, timeout=5)
        try:
            lock.execute("BEGIN IMMEDIATE")
            lock_acquired.set()
            time.sleep(0.8)
            lock.rollback()
        finally:
            lock.close()
    def _fail_run(sp, p, mot):
        raise main.UpstreamError("mock upstream error")
        yield  # pragma: no cover —— 保证本函数是生成器
    async def scenario():
        holder = threading.Thread(target=hold_lock)
        holder.start()
        deadline = time.perf_counter() + 5
        while not lock_acquired.is_set():
            assert time.perf_counter() < deadline
            await asyncio.sleep(0.005)
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            with mock.patch.object(main, "run_upstream_stream", _fail_run):
                tasks = [asyncio.create_task(
                    ac.post("/v1/generate", headers=auth(sid),
                            json=gen_req(request_id=f"awl-{i}")))
                    for i, (sid, _) in enumerate(users)]
                await asyncio.sleep(0.15)
                t0 = time.perf_counter()
                r = await ac.get("/health")
                dt = time.perf_counter() - t0
                rs = await asyncio.gather(*tasks)
                holder.join(timeout=10)
            return r.status_code, dt, [x.status_code for x in rs]
    code, dt, codes = asyncio.run(scenario())
    assert code == 200 and dt < 0.3
    assert all(x == 200 for x in codes)   # SSE 200，流内 error 事件
    uids = [uid for _, uid in users]
    q = ",".join("?" * len(uids))
    with db() as conn:
        n = conn.execute(f"SELECT COUNT(*) FROM usage_log WHERE ok=0 AND user_id IN ({q})",
                         uids).fetchone()[0]
    assert n == 50
```

- [ ] **Step 2: 删除旧契约**

`main.py` 删除：`SYSTEM_PROMPT`、`build_user_prompt`、`TranslateReq`、`/translate` 路由、`estimate_max_cost`、`_gate_snapshot`、`call_deepseek`（其上游提取逻辑已由 `run_upstream_stream` 继承）；`_TRANSLATE_INFLIGHT` 注释更新为"`/v1/generate` 在途并发（每用户 1）"。模块顶部 docstring 增补本切片说明（新契约、闸门规则变更、幂等、取消）。

`test_billing.py` 删除依赖旧契约的用例：`test_full_flow_translate_charges`、`test_insufficient_balance_402_before_ds`、`test_failed_call_no_charge`、`test_concurrent_translate_inflight_cap_no_free_ride`、`test_gate_uses_fresh_db_snapshot_not_auth_time`、`test_gate_route_uses_fresh_snapshot_not_auth_time`、`test_gate_ordering_blocks_second_request_before_semaphore`、`test_settle_shortfall_partial_deduction`、`test_estimate_is_upper_bound`、`test_lang_fields_overlimit_422`、`test_ledger_exact_after_1000_deductions`、`test_missing_price_returns_503`、`test_charge_time_price_read_is_transactional`、`test_settle_exception_audited_500`、`test_random_costs_within_estimate_never_negative_no_free_delivery`、`test_health_responsive_under_translate_load`、`test_event_loop_free_when_audit_writes_blocked`、`mock_ds` helper、`COST_57_11` 若仅被已删用例使用则保留给 `test_generate` 导入。**其中语义仍需覆盖的，必须先在 `test_generate.py` 有对应钉子**：全流程/402/失败不扣/部分结算/并发/排序/新鲜快照/1000 次账本/缺价 503/事务取价/结算异常 → 逐项核对表：

| 旧用例语义                     | 新钉子位置                                                                  |
| ------------------------------ | --------------------------------------------------------------------------- |
| 全流程扣费                     | Task 6 `test_generate_full_flow_sse_charges`                                |
| 余额不足拒付                   | Task 6 `test_generate_zero_balance_402_no_upstream`                         |
| 失败不扣费                     | Task 6 `test_generate_upstream_error_no_charge`                             |
| 部分结算恒等式                 | Task 6 `test_generate_tiny_balance_partial_settle_delivers`                 |
| F20 并发                       | 本任务 `test_generate_inflight_cap_no_free_ride`                            |
| F50 接线/排序                  | Task 6 新鲜快照钉 + 本任务排序钉                                            |
| F2 估算上界                    | **随估价机器退役删除**（规格 §4/§12 已裁定）                                |
| F23 语言字段 422               | **删除**（字段不存在了；其精神由 `test_generate_oversize_fields_422` 继承） |
| 1000 次账本精确                | 本任务补移植（见下）                                                        |
| 缺价 503 / 事务取价 / 结算异常 | 本任务补移植（见下）                                                        |
| F15/F22/F30                    | 本任务已移植                                                                |

补移植（`test_generate.py`，改写自旧用例，上游用 `mock_stream`）：

```python
def test_ledger_exact_after_1000_generate_calls():
    c = make_client()
    sid, uid = register_and_verify(c, "k2@test.com")
    recharge(c, uid, 10.0)
    with mock_stream(usage=fake_usage(57, 11)):
        for i in range(1000):
            code, _ = _stream_generate(c, sid, gen_req(request_id=f"k2-{i}"))
            assert code == 200
    with db() as conn:
        u = conn.execute("SELECT total_spent, balance FROM users WHERE user_id=?",
                         (uid,)).fetchone()
        s = conn.execute("SELECT SUM(cost) s, COUNT(*) n FROM usage_log "
                         "WHERE user_id=? AND ok=1", (uid,)).fetchone()
    assert s["n"] == 1000
    assert u["total_spent"] == s["s"] == COST_57_11 * 1000
    assert u["balance"] == 100_000_000 - COST_57_11 * 1000


def test_missing_price_returns_503_on_generate():
    c = make_client()
    sid, uid = register_and_verify(c, "mp2@test.com")
    recharge(c, uid, 10.0)
    with db() as conn:
        conn.execute("DELETE FROM prices"); conn.commit()
    calls = []
    def _run(sp, p, mot):
        calls.append(1)
        yield "x"
        return fake_usage()
    with mock.patch.object(main, "run_upstream_stream", _run):
        r = c.post("/v1/generate", headers=auth(sid), json=gen_req())
    assert r.status_code == 503 and not calls      # F6 fail-closed：闸门在调上游之前拦截
    main.init_db()
```

（缺价有两种场景，语义不同，各有钉子：**闸门阶段缺价**——上游还没调——由 `_gate_balance` 的 fail-closed 校验拦成 HTTP 503（上面 `test_missing_price_returns_503_on_generate` 已覆盖）；**结算阶段缺价**——上游成功返回后才删价——不能 503（流已开始），必须是流内 `error` 事件 + 审计行 + 不扣费。后者的移植测试：）

```python
def test_price_deleted_after_upstream_settles_as_stream_error():
    """F7 移植：上游成功后价格被删 → 流内报错，不扣费，审计行留痕。"""
    c = make_client()
    sid, uid = register_and_verify(c, "tp2@test.com")
    recharge(c, uid, 10.0)
    def _run(sp, p, mot):
        with db() as conn:
            conn.execute("DELETE FROM prices")
            conn.commit()
        yield "Hello"
        return fake_usage()
    with mock.patch.object(main, "run_upstream_stream", _run):
        code, events = _stream_generate(c, sid, gen_req(request_id="tp2-r1"))
    assert code == 200
    assert any(ev == "error" and "计费配置缺失" in d["detail"] for ev, d in events)
    with db() as conn:
        u = conn.execute("SELECT balance FROM users WHERE user_id=?", (uid,)).fetchone()
        row = conn.execute("SELECT ok, error FROM usage_log WHERE user_id=?",
                           (uid,)).fetchone()
    assert u["balance"] == 1_000_000_000          # 未扣费
    assert row["ok"] == 0 and "billing_config_missing" in row["error"]
    main.init_db()                                   # 恢复 seed


def test_settle_exception_stream_error_audited():
    """F9 移植：结算事务异常 → 流内结构化报错 + 审计行，而非裸抛丢请求。"""
    c = make_client()
    sid, uid = register_and_verify(c, "se2@test.com")
    recharge(c, uid, 10.0)
    with mock_stream(usage=fake_usage(57, 11)), \
         mock.patch.object(main, "charge_and_log",
                           side_effect=sqlite3.OperationalError("database is locked")):
        code, events = _stream_generate(c, sid, gen_req(request_id="se2-r1"))
    assert code == 200
    assert any(ev == "error" and "结算失败" in d["detail"] for ev, d in events)
    with db() as conn:
        row = conn.execute("SELECT ok, error FROM usage_log WHERE user_id=?",
                           (uid,)).fetchone()
    assert row["ok"] == 0 and row["error"].startswith("settle_error:")
```

- [ ] **Step 3: 跑全量**

Run: `.venv/bin/pytest test_billing.py test_generate.py -q`
Expected: 全部 PASS。

- [ ] **Step 4: 更新 README**

- §0 项目状态：追加本切片说明（新契约、闸门规则变更、引用规格文档路径）；
- §1 快速开始：`/verify?token=` 步骤改为验证码流程（注册→日志里取 `code=`→`/verify-code`），翻译 curl 改为 `/v1/generate`（含 `request_id`/`feature`/`system_prompt`/`prompt`）与 `curl -N`（SSE）；
- §3 接口清单：删除 `/translate`、`GET /verify` 行；`/register` 说明改"发验证码"；`/reset-password` 入参改 `{email, code, new_password}`；新增 `/verify-code`、`/v1/generate`、`/v1/cancel` 三行（限流/并发/幂等口径按本计划 Global Constraints 原文）；
- §9 未完成项保留（支付自助化等），"前端 API 规范"一项标注"已由规格 2026-08-26 覆盖"。

- [ ] **Step 5: Commit**

```bash
git add main.py test_billing.py test_generate.py README.md
git commit -m "feat(billing): retire /translate; port invariant pins to /v1/generate"
```

---

## 验收门槛（全部满足才算完成）

1. `.venv/bin/pytest test_billing.py test_generate.py -v` 全绿；
2. `git log` 每任务一个 conventional commit；
3. `grep -n "translate" main.py` 仅剩注释/文档中的历史说明，无 `TranslateReq`/`build_user_prompt`/`estimate_max_cost`/`SYSTEM_PROMPT` 残留；
4. 交对抗评审（adversarial-review）——重点攻击面：扣到零闸门的资金不变量、掉线/取消的结算完备性、幂等竞态、验证码暴力破解面。
