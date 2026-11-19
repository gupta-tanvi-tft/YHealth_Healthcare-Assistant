import sys
import os
import time
import asyncio
import py_compile

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEAKER_BACKEND_DIR = os.path.join(BASE_DIR, "speaker-backend")
sys.path.insert(0, SPEAKER_BACKEND_DIR)

async def run_diagnostics():
    print("=" * 60)
    print("YHEALTH ASSISTANT SYSTEM DIAGNOSTIC & HEALTH CHECK")
    print("=" * 60)

    # Check 1: Compilation
    server_path = os.path.join(SPEAKER_BACKEND_DIR, "server.py")
    py_compile.compile(server_path, doraise=True)
    print("[PASS] 1. speaker-backend/server.py compiles cleanly")

    # Check 2: Import server
    import server
    print("[PASS] 2. server module imports with all dependencies")

    # Check 3: Doctor ID Regex
    assert server._DOCTOR_ID_RE.match("6789ebb61a093d60fa691c39"), "Regex failed on mongo ID"
    assert server._DOCTOR_ID_RE.match("default"), "Regex failed on default"
    print("[PASS] 3. _DOCTOR_ID_RE validates IDs correctly")

    # Check 4: Real-Time Clock & Timezone in IST
    ist_now = server.get_current_ist_datetime()
    ist_str = server.get_current_ist_time_str()
    tod = server.part_of_day()
    print(f"[PASS] 4. IST Clock: {ist_now.strftime('%Y-%m-%d %H:%M:%S')} ({ist_str}) | Part of day: {tod}")

    # Check 5: Gemini Live Tool get_current_time
    res_time = await server.run_tool("get_current_time", {})
    assert res_time["status"] == "success"
    print(f"[PASS] 5. Tool get_current_time executed: {res_time['message']}")

    # Check 6: Prompt generation
    prompt = server.build_doctor_agent_prompt()
    assert "REAL-TIME CLOCK" in prompt
    assert "Current Time:" in prompt
    assert tod in prompt
    print(f"[PASS] 6. build_doctor_agent_prompt: generated ({len(prompt)} chars, ~{len(prompt)//4} tokens)")

    # Check 7: Doctor Persona API / Daily Consultations
    doc_id = server.DEFAULT_DOCTOR_ID
    today = server.get_today_date_str()
    print(f"Fetching doctor persona for {doc_id} on {today}...")
    try:
        p = await server.async_fetch_doctor_persona(doc_id, today)
        doc_details = p.get("doctor_details", {})
        doc_name = doc_details.get("first_name", "") + " " + doc_details.get("last_name", "")
        consults = p.get("today_consultations") or p.get("consultations") or []
        print(f"[PASS] 7. Doctor Persona API online: Dr. {doc_name.strip()}, {len(consults)} consultations")
    except Exception as e:
        print(f"[WARN] 7. Doctor Persona API error: {e}")

    # Check 8: Redis connectivity
    try:
        client = server.get_redis_client()
        if asyncio.iscoroutine(client):
            client = await client
        if client:
            pong = await client.ping()
            print(f"[PASS] 8. Redis cache is CONNECTED and responsive (ping={pong})")
        else:
            print("[INFO] 8. Redis client not configured (using RAM fallback)")
    except Exception as e:
        print(f"[INFO] 8. Redis check: {e}")

    print("=" * 60)
    print("ALL BACKEND SYSTEM CHECKS COMPLETED!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(run_diagnostics())
