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

if [ ! -z ${node_pid} ];then
    echo " ${node} is running, pid is $node_pid."
    exit 0
else
    # nohup ${nodejs} ./dist >>nohup.out 2>&1 &
    # ${npx} pm2 delete wcrelay
    ${npx} pm2 start ./ecosystem.config.js
    sleep 1.5
fi
# try_times=4
# i=0
# while [ $i -lt ${try_times} ]
# do
#     node_pid=$(ps aux|grep node| grep $PWD|grep -v grep| tail -n 1|awk '{print $2}')
#     success_flag=$(tail -n30 /data/app/logs/wsdaw-wcrelay/wsdaw-wcrelay.log | grep "redis publisher initialized")
#     if [[ ! -z ${node_pid} && ! -z "${success_flag}" ]];then
#         echo -e "\033[32m ${node} start successfully pid=${node_pid}\033[0m"
#         exit 0
#     fi
#     sleep 1.5
#     ((i=i+1))
# done
# echo -e "\033[31m  Exceed waiting time. Please try again to start ${node} \033[0m"
