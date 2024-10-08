
# WalletConnect Relay

This repository is a fork of the original [WalletConnect Relay](https://github.com/WalletConnect/relay) repository and implements the minimal relay server for [WalletConnect v2.0](https://github.com/WalletConnect/walletconnect-monorepo).

## Quick Start

```
make dev
```

## Additional help

```
build                build docker images
clean                clean local environment
dev                  start local dev environment
help                 Show this help
logs                 show logs for docker containers. To get logs for a single container uses `make logs service=relay`
ps                   show docker container status
publish-dev          push docker images for dev environment to the docker hub
publish              push docker images to docker hub
pull                 pull image environment
stop                 stop local environment
test-client          runs "./packages/client" tests against the locally running relay
test-production      runs "./packages/client" tests against the relay.walletconnect.com
test-relay           runs "./test" tests against the locally running relay
test-staging         runs "./packages/client" tests against the staging.walletconnect.com
```

## compile and test

### Install nodejs 16

```bash
# install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# install nodejs 16
nvm install 16
```

### Install redis

```bash
# install redis on centOS
sudo yum install redis
# start redis
sudo systemctl start redis
```

### Compile and test

```bash
# install dependencies
npm install
# install typescript
npm install typescript
# compile
npm run compile
# run
node ./dist/
# test
npm run test
```

## License

Apache 2.0
