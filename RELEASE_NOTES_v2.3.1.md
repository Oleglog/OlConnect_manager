# OlConnect Manager server-v2.3.1 — Переход на надежный режим L4 для OpenFlux

Обновление лаунчера и установщика сервера OlConnect:

### Что изменилось:
1. **Режим по умолчанию для OpenFlux переключён на `l4` (proxy mode)**:
   - Обеспечивает 100% совместимость с любыми облачными VPS (Hetzner, AWS, Timeweb, Selectel и др.) без сбоев из-за NAT провайдера и конфликтов с iptables/nftables.
2. **Автоматическое использование обновлённого бинарника OpenFlux v0.5.1**:
   - Поддерживает исправления транспорта Mail.ru Docs.

### Как обновить сервер:
Для обновления выполните на сервере от `root`:
```bash
curl -fsSL https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/olcrtc-setup.sh | sudo bash -s -- --update
```
Или обновите только бинарник OpenFlux:
```bash
curl -fsSL https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/update-openflux.sh | sudo bash
systemctl restart olcrtc@*
```
