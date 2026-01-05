<template>
  <div class="connected-rooms">
    <div class="rooms-header">
      <span class="rooms-title">已连接房间 ({{ rooms.length }})</span>
    </div>
    <div class="rooms-list">
      <div
        v-for="room in rooms"
        :key="room.id"
        class="room-item"
        :class="{
          active: room.id === activeRoomId,
          error: room.hasError,
          connecting: !room.isConnected && !room.hasError
        }"
        @click="$emit('select', room.id)">
        <div class="room-info">
          <div class="room-header">
            <span class="room-number">{{ room.roomNum }}</span>
            <span v-if="room.unreadCount > 0" class="unread-badge">{{ room.unreadCount }}</span>
          </div>
          <div class="room-status">
            <span class="status-indicator" :class="getStatusClass(room)"></span>
            <span class="room-name">{{ getRoomName(room) }}</span>
          </div>
        </div>
        <div class="room-actions">
          <button class="btn-remove" @click.stop="$emit('remove', room.id)" title="断开连接">
            <i class="ice-close"></i>
          </button>
        </div>
      </div>
      <div v-if="rooms.length === 0" class="empty-state">
        <span>暂无连接的房间</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DyLiveInfo } from '@/core/dycast';

interface RoomDisplay {
  id: string;
  roomNum: string;
  info?: DyLiveInfo;
  isConnected: boolean;
  hasError: boolean;
  unreadCount: number;
}

interface Props {
  rooms: RoomDisplay[];
  activeRoomId: string | null;
}

const props = defineProps<Props>();

defineEmits<{
  select: [roomId: string];
  remove: [roomId: string];
}>();

const getStatusClass = (room: RoomDisplay) => {
  if (room.hasError) return 'status-error';
  if (!room.isConnected) return 'status-connecting';
  return 'status-connected';
};

const getRoomName = (room: RoomDisplay) => {
  if (room.hasError) return '连接错误';
  if (!room.isConnected) return '连接中...';
  return room.info?.nickname || '未知主播';
};
</script>

<style lang="scss" scoped>
$bg: #f7f6f5;
$bd: #b2bfc3;
$theme: #68be8d;
$error: #e74c3c;
$warning: #f39c12;
$text: #333;
$text-light: #666;

.connected-rooms {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: $bg;
  border-radius: 8px;
  overflow: hidden;
}

.rooms-header {
  padding: 12px 16px;
  background-color: #eeeded;
  border-bottom: 1px solid $bd;
}

.rooms-title {
  font-size: 14px;
  font-weight: 600;
  color: $text;
}

.rooms-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.room-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background-color: #fff;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: #e8f5ee;
    border-color: #a8d9c2;
  }

  &.active {
    background-color: #d4f0e0;
    border-color: $theme;
    box-shadow: 0 2px 8px rgba($theme, 0.2);
  }

  &.error {
    background-color: #fce4e4;
    border-color: #f5b7b1;
  }

  &.connecting {
    opacity: 0.7;
  }
}

.room-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.room-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.room-number {
  font-size: 14px;
  font-weight: 600;
  color: $text;
}

.unread-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background-color: $error;
  color: #fff;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}

.room-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.status-connected {
    background-color: $theme;
  }

  &.status-connecting {
    background-color: $warning;
    animation: pulse 1.5s ease-in-out infinite;
  }

  &.status-error {
    background-color: $error;
  }
}

.room-name {
  font-size: 13px;
  color: $text-light;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.room-actions {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}

.btn-remove {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  border: 1px solid $bd;
  border-radius: 6px;
  cursor: pointer;
  color: $text-light;
  transition: all 0.2s ease;
  font-size: 14px;

  &:hover {
    background-color: $error;
    border-color: $error;
    color: #fff;
  }

  &:active {
    opacity: 0.8;
  }
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: $text-light;
  font-size: 14px;
  text-align: center;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>

