"""Security tests for Shatabli's Supabase backend (RLS, grants, triggers).

Anonymous checks always run. Logged-in checks run when you give two TEST
accounts (never real users) through environment variables:

    SHB_A_EMAIL / SHB_A_PASS  -> a customer test account
    SHB_B_EMAIL / SHB_B_PASS  -> a second customer test account

Run:  python3 tests/security_test.py
Only the publishable key is used; no secret keys are needed or allowed.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = open(os.path.join(ROOT, "config.js"), encoding="utf-8").read()
URL = re.search(r"url:\s*'([^']+)'", cfg).group(1)
KEY = re.search(r"key:\s*'([^']+)'", cfg).group(1)
assert KEY.startswith("sb_publishable_"), "config.js must only contain the publishable key"

passed = failed = 0


def call(method, path, body=None, token=None, extra=None):
    headers = {"apikey": KEY, "Content-Type": "application/json", "Prefer": "return=representation"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except ValueError:
            return e.code, txt


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("  PASS", name)
    else:
        failed += 1
        print("  FAIL", name, detail)


def denied(status, body):
    """Request refused, or allowed but affected nothing."""
    return status >= 400 or body in ([], None)


print("Anonymous (not logged in):")
for table in ("profiles", "requests"):
    s, b = call("GET", f"/rest/v1/{table}?select=*")
    check(f"cannot read {table}", s >= 400, s)
s, b = call("GET", "/rest/v1/craftsmen?select=status")
check("only approved craftsmen are visible", s == 200 and all(r["status"] == "approved" for r in b), b)
s, b = call("POST", "/rest/v1/requests", {"craftsman_id": "00000000-0000-0000-0000-000000000000", "description": "test", "address": "test"})
check("cannot create requests", s >= 400, s)
s, b = call("POST", "/rest/v1/craftsmen", {"name": "x", "category": "paint", "price": 1})
check("cannot create craftsmen", s >= 400, s)
s, b = call("POST", "/rest/v1/reviews", {"request_id": "00000000-0000-0000-0000-000000000000", "stars": 5})
check("cannot write reviews", s >= 400, s)
s, b = call("PATCH", "/rest/v1/quick_services?id=eq.1", {"price": 1})
check("cannot change prices", denied(s, b), s)
for fn, args in (("book_quick_service", {"p_service_id": 1, "p_address": "abc", "p_day": "x"}),
                 ("book_helper", {"p_task": "move", "p_helpers": 1, "p_hours": 2, "p_address": "abc", "p_day": "x"}),
                 ("admin_set_craftsman_status", {"p_id": "00000000-0000-0000-0000-000000000000", "p_status": "approved"})):
    s, b = call("POST", f"/rest/v1/rpc/{fn}", args)
    check(f"cannot call {fn}", s >= 400, s)
s, b = call("POST", "/rest/v1/rpc/is_admin", {})
check("is_admin is false for anonymous", s == 200 and b is False, b)

A = (os.environ.get("SHB_A_EMAIL"), os.environ.get("SHB_A_PASS"))
B = (os.environ.get("SHB_B_EMAIL"), os.environ.get("SHB_B_PASS"))
if all(A) and all(B):
    def login(email, pw):
        s, b = call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw})
        assert s == 200, f"login failed for a test account ({s})"
        return b["access_token"], b["user"]["id"]

    ta, ida = login(*A)
    tb, idb = login(*B)
    print("Logged in (two test accounts):")
    s, b = call("PATCH", f"/rest/v1/profiles?id=eq.{ida}", {"role": "admin"}, ta)
    check("cannot make yourself admin", s >= 400, s)
    s, b = call("POST", "/rest/v1/rpc/is_admin", {}, ta)
    check("test account is not admin", b is False, b)
    s, b = call("GET", f"/rest/v1/profiles?id=eq.{idb}&select=phone", None, ta)
    check("cannot read another user's phone", s == 200 and b == [], b)
    s, b = call("PATCH", f"/rest/v1/profiles?id=eq.{idb}", {"full_name": "hacked"}, ta)
    check("cannot edit another user's profile", denied(s, b), s)
    s, b = call("GET", f"/rest/v1/requests?customer_id=eq.{idb}&select=id", None, ta)
    check("cannot list another user's requests", s == 200 and b == [], b)
    s, b = call("POST", "/rest/v1/requests", {"craftsman_id": idb, "description": "x", "address": "x", "price": 1, "status": "done"}, ta)
    check("cannot set price/status on a new request", s >= 400, s)
    s, b = call("PATCH", f"/rest/v1/craftsmen?id=eq.{ida}", {"status": "approved", "rating_avg": 5}, ta)
    check("cannot approve or rate yourself", s >= 400 or not b or all(r.get("status") != "approved" or r.get("rating_avg") != 5 for r in b), b)
    s, b = call("POST", "/rest/v1/rpc/admin_set_craftsman_status", {"p_id": ida, "p_status": "approved"}, ta)
    check("non-admin cannot approve craftsmen", s >= 400, s)
    s, b = call("PATCH", "/rest/v1/profiles?id=eq." + ida, {"phone": "<script>"}, ta)
    check("phone must be digits", s >= 400, s)
else:
    print("Logged-in checks skipped: set SHB_A_EMAIL/SHB_A_PASS and SHB_B_EMAIL/SHB_B_PASS (test accounts only).")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
