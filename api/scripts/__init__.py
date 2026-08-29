"""Runnable one-off operator scripts.

Same reasoning as ``data/__init__.py``: the Docker build context is
``api/``, so this package lives under ``api/`` to ship in the image, and is
invoked from that directory the same way ``data/job_worker.py`` is —
``python -m scripts.<name>`` — so ``data.*`` imports resolve correctly.
"""
