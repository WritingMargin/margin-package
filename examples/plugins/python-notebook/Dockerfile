FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MARGIN_PLUGIN_HOST=0.0.0.0
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --uid 10001 --create-home margin
COPY manifest.json manifest.py runtime.py server.py ./
USER 10001:10001
EXPOSE 8101
CMD ["python", "server.py"]
