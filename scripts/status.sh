
#!/bin/bash
SHELL_FOLDER=$(cd $(dirname $0);pwd)

LOG_ERROR() {
    content=${1}
    echo -e "\033[31m[ERROR] ${content}\033[0m"
}

LOG_INFO() {
    content=${1}
    echo -e "\033[32m[INFO] ${content}\033[0m"
}

export PATH=$PATH:${SHELL_FOLDER}/node-v16.20.2-linux-x64/bin/
nodejs=${SHELL_FOLDER}/node-v16.20.2-linux-x64/bin/node
npx=${SHELL_FOLDER}/node-v16.20.2-linux-x64/bin/npx
cd ${SHELL_FOLDER}
node=$(basename ${SHELL_FOLDER})
node_pid=$(ps aux|grep node| grep $PWD|grep -v grep| tail -n 1|awk '{print $2}')
ulimit -n 1024

${npx} pm2 ls
  