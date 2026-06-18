# mqtt_loop.py
import asyncio
import threading

# Try to enable uvloop
try:
    import uvloop
    asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
except Exception:
    pass


class SharedLoop:
    _loop = None
    _thread = None

    @classmethod
    def get_loop(cls):
        """Global unique asyncio loop"""
        if cls._loop is None:
            cls._loop = asyncio.new_event_loop()

            def run(loop):
                asyncio.set_event_loop(loop)
                loop.run_forever()

            cls._thread = threading.Thread(
                target=run,
                args=(cls._loop,),
                daemon=True
            )
            cls._thread.start()

        return cls._loop
