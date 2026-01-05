<template>
  <div class="index-view">
    <div class="view-left">
      <LiveInfo
        :cover="cover"
        :title="title"
        :avatar="avatar"
        :nickname="nickname"
        :follow-count="followCount"
        :member-count="memberCount"
        :user-count="userCount"
        :like-count="likeCount" />
      <div class="view-left-bottom">
        <div class="view-left-tools">
          <div class="view-left-tool" title="保存弹幕" @click.stop="saveCastToFile">
            <i class="ice-save"></i>
          </div>
        </div>
        <hr class="hr" />
        <LiveStatusPanel ref="panel" :status="connectStatus" />
      </div>
    </div>
    <div class="view-center">
      <!-- 主要弹幕：聊天、礼物 -->
      <CastList :types="['chat', 'gift']" ref="castEl" />
    </div>
    <div class="view-right">
      <div class="view-input">
        <ConnectInput
          ref="roomInput"
          label="房间号"
          placeholder="请输入房间号"
          v-model:value="roomNum"
          :test="verifyRoomNumber"
          @confirm="connectLive"
          confirm-text="连接"
          cancel-text="断开全部"
          @cancel="disconnectAllRooms" />
        <ConnectInput
          ref="relayInput"
          label="WS地址"
          placeholder="请输入转发地址"
          confirm-text="转发"
          cancel-text="停止"
          v-model:value="relayUrl"
          :test="verifyWssUrl"
          @confirm="relayCast"
          @cancel="stopRelayCast" />
      </div>
      <div class="view-rooms">
        <!-- 已连接房间列表 -->
        <ConnectedRoomsList
          :rooms="connectedRooms"
          :active-room-id="activeRoomId"
          @select="switchRoom"
          @remove="removeRoom" />
      </div>
      <div class="view-other">
        <!-- 其它弹幕：关注、点赞、进入、控制台等 -->
        <CastList ref="otherEl" :types="['social', 'like', 'member']" pos="left" no-prefix theme="dark" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ConnectInput from '@/components/ConnectInput.vue';
import LiveInfo from '@/components/LiveInfo.vue';
import LiveStatusPanel from '@/components/LiveStatusPanel.vue';
import CastList from '@/components/CastList.vue';
import ConnectedRoomsList from '@/components/ConnectedRoomsList.vue';
import {
  CastMethod,
  DyCast,
  DyCastCloseCode,
  RoomStatus,
  type ConnectStatus,
  type DyLiveInfo,
  type DyMessage,
  type LiveRoom
} from '@/core/dycast';
import { RoomManager, type RoomInstance } from '@/core/roomManager';
import { verifyRoomNum, verifyWsUrl } from '@/utils/verifyUtil';
import { ref, useTemplateRef, computed, onUnmounted } from 'vue';
import { CLog } from '@/utils/logUtil';
import { getId } from '@/utils/idUtil';
import { RelayCast } from '@/core/relay';
import SkMessage from '@/components/Message';
import { formatDate } from '@/utils/commonUtil';
import FileSaver from '@/utils/fileUtil';

// 房间管理器
const roomManager = new RoomManager();

// 连接状态
const connectStatus = ref<ConnectStatus>(0);
// 转发状态
const relayStatus = ref<ConnectStatus>(0);
// 房间号
const roomNum = ref<string>('');
// 房间号输入框状态
const roomInputRef = useTemplateRef('roomInput');
// 转发地址
const relayUrl = ref<string>('');
const relayInputRef = useTemplateRef('relayInput');
// 状态面板
const statusPanelRef = useTemplateRef('panel');

/** 直播间信息 */
const cover = ref<string>('');
const title = ref<string>('*****');
const avatar = ref<string>('');
const nickname = ref<string>('***');
const followCount = ref<string | number>('*****');
const memberCount = ref<string | number>('*****');
const userCount = ref<string | number>('*****');
const likeCount = ref<string | number>('*****');

// 主要弹幕
const castRef = useTemplateRef('castEl');
// 其它弹幕
const otherRef = useTemplateRef('otherEl');
// 已连接的房间列表（用于显示）
interface RoomDisplay {
  id: string;
  roomNum: string;
  info?: DyLiveInfo;
  isConnected: boolean;
  hasError: boolean;
  unreadCount: number;
}
const connectedRooms = ref<RoomDisplay[]>([]);
// 当前活动房间ID
const activeRoomId = ref<string | null>(null);
// 转发客户端
let relayWs: RelayCast | undefined;

// 设置房间管理器事件监听
roomManager.on('roomAdded', room => {
  updateRoomsList();
  addConsoleMessage(`正在连接房间 ${room.roomNum} [${room.id}]`);
  CLog.info(`[IndexView] roomAdded 事件: ${room.roomNum} (${room.id})`);
});

roomManager.on('roomConnected', (roomId, info) => {
  updateRoomsList();
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  
  SkMessage.success(`房间连接成功 [${room.roomNum}]`);
  addConsoleMessage(`房间 ${room.roomNum} 已连接`);
  
  // 如果是当前活动房间，更新信息
  if (activeRoomId.value === roomId) {
    setRoomInfo(info);
    connectStatus.value = 1;
  }
  
  // 发送直播间信息给转发地址
  if (relayWs && relayWs.isConnected() && activeRoomId.value === roomId) {
    relayWs.send(JSON.stringify(info));
  }
});

roomManager.on('roomDisconnected', roomId => {
  updateRoomsList();
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  
  addConsoleMessage(`房间 ${room.roomNum} 已断开`);
  
  // 如果是当前活动房间，更新状态
  if (activeRoomId.value === roomId) {
    connectStatus.value = 3;
  }
});

roomManager.on('roomError', (roomId, error) => {
  updateRoomsList();
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  
  SkMessage.error(`房间 ${room.roomNum} 出错: ${error.message}`);
  
  // 如果是当前活动房间，更新状态
  if (activeRoomId.value === roomId) {
    connectStatus.value = 2;
  }
});

roomManager.on('roomMessages', (roomId, messages) => {
  updateRoomsList();
  
  // 如果是当前活动房间，显示消息
  if (activeRoomId.value === roomId) {
    handleMessages(messages);
  }
});

roomManager.on('activeRoomChanged', roomId => {
  activeRoomId.value = roomId;
  updateRoomsList();
});

roomManager.on('roomRemoved', roomId => {
  updateRoomsList();
});

// 清理函数
onUnmounted(() => {
  roomManager.clearAll();
  if (relayWs) relayWs.close(1000);
});

/**
 * 验证房间号
 * @param value
 * @returns
 */
function verifyRoomNumber(value: string) {
  const flag = verifyRoomNum(value);
  if (flag) return { flag, message: '' };
  else {
    return { flag, message: '房间号错误' };
  }
}

/**
 * 验证转发地址 WsUrl
 * @param value
 * @returns
 */
function verifyWssUrl(value: string) {
  const flag = verifyWsUrl(value);
  if (flag) return { flag, message: '' };
  else {
    return { flag, message: '转发地址错误' };
  }
}

/** 设置房间号输入框状态 */
const setRoomInputStatus = function (flag?: boolean) {
  if (roomInputRef.value) roomInputRef.value.setStatus(flag);
};

/** 设置转发地址输入框状态 */
const setRelayInputStatus = function (flag?: boolean) {
  if (relayInputRef.value) relayInputRef.value.setStatus(flag);
};

/**
 * 设置房间统计信息
 * @param room
 * @returns
 */
const setRoomCount = function (room?: LiveRoom) {
  if (!room) return;
  if (room.audienceCount) memberCount.value = `${room.audienceCount}`;
  if (room.followCount) followCount.value = `${room.followCount}`;
  if (room.likeCount) likeCount.value = `${room.likeCount}`;
  if (room.totalUserCount) userCount.value = `${room.totalUserCount}`;
};
/**
 * 设置直播间信息
 * @param info
 */
const setRoomInfo = function (info?: DyLiveInfo) {
  if (!info) return;
  if (info.cover) cover.value = info.cover;
  if (info.title) title.value = info.title;
  if (info.avatar) avatar.value = info.avatar;
  if (info.nickname) nickname.value = info.nickname;
};

/**
 * 处理消息列表（仅用于当前活动房间的显示）
 */
const handleMessages = function (msgs: DyMessage[]) {
  const mainCasts: DyMessage[] = [];
  const otherCasts: DyMessage[] = [];
  
  try {
    for (const msg of msgs) {
      if (!msg.id) continue;
      
      switch (msg.method) {
        case CastMethod.CHAT:
          mainCasts.push(msg);
          break;
        case CastMethod.GIFT:
          if (!msg?.gift?.repeatEnd) {
            mainCasts.push(msg);
          }
          break;
        case CastMethod.LIKE:
          otherCasts.push(msg);
          setRoomCount(msg.room);
          break;
        case CastMethod.MEMBER:
          otherCasts.push(msg);
          setRoomCount(msg.room);
          break;
        case CastMethod.SOCIAL:
          otherCasts.push(msg);
          setRoomCount(msg.room);
          break;
        case CastMethod.EMOJI_CHAT:
          mainCasts.push(msg);
          break;
        case CastMethod.ROOM_USER_SEQ:
          setRoomCount(msg.room);
          break;
        case CastMethod.ROOM_STATS:
          setRoomCount(msg.room);
          break;
        case CastMethod.CONTROL:
          if (msg?.room?.status !== RoomStatus.LIVING) {
            // 已经下播
            otherCasts.push(msg);
            addConsoleMessage('主播已下播');
          }
          break;
      }
    }
  } catch (err) {
    CLog.error('处理消息出错:', err);
  }
  
  if (castRef.value) castRef.value.appendCasts(mainCasts);
  if (otherRef.value) otherRef.value.appendCasts(otherCasts);
  
  // 转发消息
  if (relayWs && relayWs.isConnected()) {
    relayWs.send(JSON.stringify(msgs));
  }
};

/**
 * 添加控制台消息
 * @param msg
 */
const addConsoleMessage = function (content: string) {
  if (otherRef.value)
    otherRef.value.appendCasts([
      {
        id: getId(),
        method: CastMethod.CUSTOM,
        content,
        user: { name: '控制台' }
      }
    ]);
};

/**
 * 清理当前显示的消息列表
 */
function clearMessageList() {
  if (castRef.value) castRef.value.clearCasts();
  if (otherRef.value) otherRef.value.clearCasts();
}

/**
 * 连接房间
 */
const connectLive = async function () {
  try {
    const roomNumber = roomNum.value.trim();
    if (!roomNumber) {
      SkMessage.warning('请输入房间号');
      setRoomInputStatus(false);
      return;
    }

    // 如果已有房间在连接中，添加小延迟避免同时连接
    const allRooms = roomManager.getAllRooms();
    const hasConnectingRooms = allRooms.some(r => !r.isConnected && !r.hasError);
    
    if (hasConnectingRooms && allRooms.length > 0) {
      CLog.info('已有房间正在连接中，等待 1 秒后再连接新房间');
      SkMessage.info(`已有房间正在连接中，请稍候...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    CLog.debug('正在连接:', roomNumber);
    SkMessage.info(`正在连接：${roomNumber}`);
    
    const roomId = await roomManager.addRoom(roomNumber);
    updateRoomsList();
    
    // 清空输入框并重新启用，以便添加更多房间
    roomNum.value = '';
    setRoomInputStatus(false);
  } catch (err) {
    CLog.error('房间连接过程出错:', err);
    SkMessage.error('房间连接过程出错');
    setRoomInputStatus(false);
  }
};

/**
 * 断开所有房间
 */
const disconnectAllRooms = function () {
  if (roomManager.getRoomCount() === 0) {
    SkMessage.info('当前没有连接的房间');
    return;
  }
  
  roomManager.clearAll();
  connectedRooms.value = [];
  activeRoomId.value = null;
  clearMessageList();
  resetRoomInfo();
  connectStatus.value = 0;
  SkMessage.success('已断开所有房间');
  addConsoleMessage('已断开所有房间');
};

/**
 * 移除指定房间
 */
const removeRoom = function (roomId: string) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  
  roomManager.removeRoom(roomId);
  updateRoomsList();
  
  // 如果移除的是当前活动房间，需要更新显示
  if (activeRoomId.value === roomId) {
    const activeRoom = roomManager.getActiveRoom();
    if (activeRoom) {
      switchRoom(activeRoom.id);
    } else {
      clearMessageList();
      resetRoomInfo();
      connectStatus.value = 0;
      activeRoomId.value = null;
    }
  }
  
  SkMessage.success(`已断开房间 ${room.roomNum}`);
  addConsoleMessage(`已断开房间 ${room.roomNum}`);
};

/**
 * 切换房间
 */
const switchRoom = function (roomId: string) {
  roomManager.setActiveRoom(roomId);
  activeRoomId.value = roomId;
  updateRoomsList();
  
  const room = roomManager.getActiveRoom();
  if (!room) return;
  
  // 更新房间信息
  setRoomInfo(room.info);
  
  // 更新连接状态
  if (room.isConnected) {
    connectStatus.value = 1;
  } else if (room.hasError) {
    connectStatus.value = 2;
  } else {
    connectStatus.value = 0;
  }
  
  // 清空当前显示的弹幕
  if (castRef.value) castRef.value.clearCasts();
  if (otherRef.value) otherRef.value.clearCasts();
  
  // 加载该房间的所有消息
  loadRoomMessages(room);
  
  CLog.info(`切换到房间 ${room.roomNum}`);
};

/**
 * 更新房间列表
 */
const updateRoomsList = function () {
  connectedRooms.value = roomManager.getAllRooms().map(room => ({
    id: room.id,
    roomNum: room.roomNum,
    info: room.info,
    isConnected: room.isConnected,
    hasError: room.hasError,
    unreadCount: room.unreadCount
  }));
};

/**
 * 加载房间消息
 */
const loadRoomMessages = function (room: RoomInstance) {
  const mainCasts: DyMessage[] = [];
  const otherCasts: DyMessage[] = [];
  
  for (const msg of room.messages) {
    switch (msg.method) {
      case CastMethod.CHAT:
      case CastMethod.GIFT:
      case CastMethod.EMOJI_CHAT:
        mainCasts.push(msg);
        break;
      case CastMethod.LIKE:
      case CastMethod.MEMBER:
      case CastMethod.SOCIAL:
        otherCasts.push(msg);
        // 更新房间统计信息
        setRoomCount(msg.room);
        break;
      case CastMethod.ROOM_USER_SEQ:
      case CastMethod.ROOM_STATS:
        setRoomCount(msg.room);
        break;
    }
  }
  
  if (castRef.value) castRef.value.appendCasts(mainCasts);
  if (otherRef.value) otherRef.value.appendCasts(otherCasts);
};

/**
 * 重置房间信息
 */
const resetRoomInfo = function () {
  cover.value = '';
  title.value = '*****';
  avatar.value = '';
  nickname.value = '***';
  followCount.value = '*****';
  memberCount.value = '*****';
  userCount.value = '*****';
  likeCount.value = '*****';
};

/** 连接转发房间 */
const relayCast = function () {
  try {
    CLog.info('正在连接转发中 =>', relayUrl.value);
    SkMessage.info(`转发连接中: ${relayUrl.value}`);
    const cast = new RelayCast(relayUrl.value);
    cast.on('open', () => {
      CLog.info(`DyCast 转发连接成功`);
      SkMessage.success(`已开始转发`);
      setRelayInputStatus(true);
      relayStatus.value = 1;
      addConsoleMessage('转发客户端已连接');
      
      // 发送当前活动房间的直播间信息给转发地址
      const activeRoom = roomManager.getActiveRoom();
      if (activeRoom && activeRoom.info) {
        cast.send(JSON.stringify({
          ...activeRoom.info,
          roomNum: activeRoom.roomNum
        }));
      }
    });
    cast.on('close', (code, msg) => {
      CLog.info(`(${code})dycast 转发已关闭: ${msg || '未知原因'}`);
      if (code === 1000) SkMessage.info(`已停止转发`);
      else SkMessage.warning(`转发已停止: ${msg || '未知原因'}`);
      setRelayInputStatus(false);
      relayStatus.value = 0;
      addConsoleMessage('转发已关闭');
    });
    cast.on('error', ev => {
      CLog.warn(`dycast 转发出错: ${ev.message}`);
      SkMessage.error(`转发出错了: ${ev.message}`);
      setRelayInputStatus(false);
      relayStatus.value = 2;
    });
    cast.connect();
    relayWs = cast;
  } catch (err) {
    CLog.error('弹幕转发出错:', err);
    SkMessage.error('转发出错: ${err.message}');
    setRelayInputStatus(false);
    relayStatus.value = 2;
    relayWs = void 0;
  }
};
/** 暂停转发 */
const stopRelayCast = function () {
  if (relayWs) relayWs.close(1000);
};

/** 将弹幕保存到本地文件 */
const saveCastToFile = function () {
  const activeRoom = roomManager.getActiveRoom();
  if (!activeRoom) {
    SkMessage.warning('请先连接房间');
    return;
  }
  
  if (activeRoom.isConnected) {
    SkMessage.warning('请断开连接后再保存');
    return;
  }
  
  const len = activeRoom.messages.length;
  if (len <= 0) {
    SkMessage.warning('暂无弹幕需要保存');
    return;
  }
  
  const date = formatDate(new Date(), 'yyyy-MM-dd_HHmmss');
  const fileName = `[${activeRoom.roomNum}]${date}(${len})`;
  const data = JSON.stringify(activeRoom.messages, null, 2);
  
  FileSaver.save(data, {
    name: fileName,
    ext: '.json',
    mimeType: 'application/json',
    description: '弹幕数据',
    existStrategy: 'new'
  })
    .then(res => {
      if (res.success) {
        SkMessage.success('弹幕保存成功');
      } else {
        SkMessage.error('弹幕保存失败');
        CLog.error('弹幕保存失败 =>', res.message);
      }
    })
    .catch(err => {
      SkMessage.error('弹幕保存出错了');
      CLog.error('弹幕保存出错了 =>', err);
    });
};
</script>

<style lang="scss" scoped>
$bg: #f7f6f5;
$bd: #b2bfc3;
$theme: #68be8d;
$tool: #8b968d;

.index-view {
  position: relative;
  background-color: $bg;
  display: flex;
  width: 100%;
  height: 100%;
  .view-left,
  .view-center,
  .view-right {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    width: 0;
    flex-shrink: 0;
  }
  .view-left {
    flex-grow: 2.5;
    border-right: 1px solid $bd;
    justify-content: space-between;
  }
  .view-left-bottom {
    width: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 12px 0;
    .hr {
      height: 0;
      border: 0;
      border-top: 1px solid $bd;
      margin: 5px 0;
    }
  }
  .view-left-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    box-sizing: border-box;
    padding: 0 12px;
  }
  .view-left-tool {
    font-size: 21px;
    width: 1.2em;
    height: 1.2em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: $tool;
    transition: color 0.2s ease-in-out, background-color 0.3s ease-in-out, opacity 0.2s ease;
    background-color: transparent;
    border-radius: 0.4em;
    i {
      font-size: 1em;
    }
    &:hover {
      color: #fff;
      background-color: $theme;
    }
    &:active {
      opacity: 0.8;
    }
  }
  .view-center {
    flex-grow: 4.5;
    padding: 18px 12px;
  }
  .view-right {
    flex-grow: 3;
    border-left: 1px solid $bd;
    padding: 18px 12px;
    gap: 12px;
  }
  .view-input {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .view-rooms {
    width: 100%;
    height: 220px;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .view-other {
    display: flex;
    width: 100%;
    height: 0;
    flex-grow: 1;
    box-sizing: border-box;
  }
}

@media (max-width: 768px) {
  .index-view {
    flex-direction: column;
    height: auto;
    .view-left,
    .view-center,
    .view-right {
      width: 100%;
      flex-grow: 0;
      border: none;
    }
    .view-left {
      margin-top: 250px;
      justify-content: flex-start;
    }
    .view-center {
      height: 100vh;
    }
    .view-right {
      height: auto;
      min-height: 80vh;
    }
    .view-input {
      position: absolute;
      top: 0;
      left: 0;
      box-sizing: border-box;
      padding: 18px 12px;
    }
    .view-rooms {
      height: 180px;
    }
    .view-left-bottom {
      position: absolute;
      top: 150px;
      left: 0;
    }
  }
}
</style>
