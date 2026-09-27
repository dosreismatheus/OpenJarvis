"""Build a Caddy candidate without changing the active configuration."""

from pathlib import Path

active = Path('/etc/caddy/Caddyfile')
template = Path('/root/seven-voice-next.template')
password_hash = Path('/root/seven-voice-login-20260926.hash')
candidate = Path('/etc/caddy/Caddyfile.seven-next')

old_block = '''voice.seven.7build.com.br {
  root * /srv/seven-voice
  encode zstd gzip
  try_files {path} /index.html
  file_server
}'''

current = active.read_text()
if current.count(old_block) != 1:
    raise SystemExit('O bloco atual do domínio não corresponde ao esperado; nenhuma alteração foi feita.')

new_block = template.read_text().strip().replace('__BCRYPT_HASH__', password_hash.read_text().strip())
candidate.write_text(current.replace(old_block, new_block))
candidate.chmod(0o600)
print(candidate)
