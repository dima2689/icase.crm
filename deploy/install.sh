#!/usr/bin/env bash
# Первичная подготовка чистого сервера Ubuntu 22.04/24.04 под iCase. Запуск от root:
#   1) скопируйте папку deploy на сервер:  scp -r deploy root@IP:/root/icase-deploy
#   2) заполните настройки:                cp /root/icase-deploy/icase.env.example /etc/icase/icase.env && nano /etc/icase/icase.env
#   3) запустите:                          bash /root/icase-deploy/install.sh "ssh-ed25519 AAAA... github-actions"
# Аргумент — публичный SSH-ключ, с которым GitHub Actions будет выкладывать новые версии.
# Повторный запуск безопасен.
set -euo pipefail
trap 'echo "install.sh: ошибка в строке $LINENO: $BASH_COMMAND" >&2' ERR
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
[ "$(id -u)" = 0 ] || die "запускайте от root"
DEPLOY_PUBKEY="${1:-}"
. /etc/os-release; [ "$ID" = ubuntu ] || warn "проверено на Ubuntu, у вас $PRETTY_NAME"

mkdir -p /etc/icase; chmod 700 /etc/icase
if [ ! -f "$ICASE_ENV" ]; then cp "$HERE/icase.env.example" "$ICASE_ENV"; chmod 600 "$ICASE_ENV"; die "заполните $ICASE_ENV и запустите снова"; fi
chmod 600 "$ICASE_ENV"; load_env
[ -n "${BACKUP_PASSPHRASE:-}" ] || die "задайте BACKUP_PASSPHRASE в $ICASE_ENV"
[[ "$CRM_DOMAIN" != *example* && "$API_DOMAIN" != *example* ]] || die "укажите свои домены в $ICASE_ENV"

log "пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git jq gnupg rclone rsync python3 openssl ufw fail2ban unattended-upgrades >/dev/null
# Docker: если уже установлен (у некоторых провайдеров в образе), не трогаем
if ! docker compose version >/dev/null 2>&1; then apt-get install -y -qq docker.io docker-compose-v2 >/dev/null; fi
cv=$(docker compose version --short 2>/dev/null | sed 's/^v//')
python3 -c "import sys;v=[int(x) for x in sys.argv[1].split('.')[:2]];sys.exit(0 if v>=[2,24] else 1)" "${cv:-0.0}" || die "нужен docker compose ≥ 2.24 (сейчас ${cv:-нет})"

log "Docker: зеркала реестра и ротация логов"
mkdir -p /etc/docker
# дополняем существующий daemon.json (у провайдера/в образе могут быть свои настройки), а не затираем
[ -f /etc/docker/daemon.json ] && cp /etc/docker/daemon.json /etc/docker/daemon.json.icase-bak
python3 - "${DOCKER_MIRRORS:-}" <<'PY'
import json,os,sys
p='/etc/docker/daemon.json'
try: d=json.load(open(p))
except Exception: d={}
m=json.loads(sys.argv[1]) if sys.argv[1] else ["https://mirror.gcr.io","https://dockerhub.timeweb.cloud"]
d.setdefault('registry-mirrors',m)
if 'log-driver' not in d: d['log-driver']='json-file'; d['log-opts']={"max-size":"20m","max-file":"5"}
d.setdefault('live-restore',True)
json.dump(d,open(p,'w'),indent=2)
PY
systemctl enable docker >/dev/null 2>&1 || true
if ! systemctl restart docker; then
  journalctl -u docker --no-pager -n 15 || true
  warn "Docker не принял настройки — возвращаю прежние"
  if [ -f /etc/docker/daemon.json.icase-bak ]; then mv /etc/docker/daemon.json.icase-bak /etc/docker/daemon.json; else rm -f /etc/docker/daemon.json; fi
  systemctl restart docker || die "Docker не запускается"
fi

log "файл подкачки"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10; echo 'vm.swappiness=10' > /etc/sysctl.d/90-icase.conf
fi

log "пользователь deploy (для GitHub Actions)"
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh /home/deploy/incoming
if [ -n "$DEPLOY_PUBKEY" ]; then
  grep -qF "$DEPLOY_PUBKEY" /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "$DEPLOY_PUBKEY" >> /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys; chmod 600 /home/deploy/.ssh/authorized_keys
fi
mkdir -p /opt/icase/bin; install -m 755 "$HERE/icase-release" /opt/icase/bin/icase-release
echo 'deploy ALL=(root) NOPASSWD: /opt/icase/bin/icase-release' > /etc/sudoers.d/icase-deploy; chmod 440 /etc/sudoers.d/icase-deploy
visudo -cqf /etc/sudoers.d/icase-deploy || { rm -f /etc/sudoers.d/icase-deploy; die "ошибка в правиле sudo для deploy"; }

log "SSH: только ключи"
if [ -s /root/.ssh/authorized_keys ] || [ -s /home/deploy/.ssh/authorized_keys ]; then
  cat > /etc/ssh/sshd_config.d/90-icase.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 4
SSHD
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || warn "не удалось перезапустить sshd — проверьте вручную"
else
  warn "нет ни одного SSH-ключа — вход по паролю оставлен. Добавьте ключ в /root/.ssh/authorized_keys и запустите снова"
fi

log "файрвол: 22, 80, 443"
ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null
echo 'APT::Periodic::Update-Package-Lists "1"; APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades

log "Supabase"
"$HERE/supabase-setup.sh"

log "таймеры: бэкап (03:30) и проверка (каждые 10 мин)"
cp "$HERE"/systemd/icase-*.service "$HERE"/systemd/icase-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable icase-backup.timer icase-health.timer >/dev/null

cat <<MSG

Готово. Дальше:
  1. DNS: A-записи $CRM_DOMAIN и $API_DOMAIN → $(curl -fsS -4 -m 5 https://ifconfig.me 2>/dev/null || echo 'IP сервера')
  2. GitHub → Settings → Secrets → Actions: DEPLOY_HOST, DEPLOY_USER=deploy, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS
     (known_hosts:  ssh-keyscan -t ed25519 $(hostname -I | awk '{print $1}'))
  3. Запустите выкладку (push в main или Actions → Deploy → Run workflow)
  4. Создайте владельца:  /opt/icase/app/deploy/create-owner.sh you@mail.ru "Имя"
  5. Запустите таймеры:   systemctl start icase-backup.timer icase-health.timer
MSG
