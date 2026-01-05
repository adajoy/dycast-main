import { CLog } from '@/utils/logUtil';
import { DyCast, type DyLiveInfo, type DyMessage } from './dycast';
import { Emitter, type EventMap } from './emitter';

export interface RoomInstance {
  id: string;
  roomNum: string;
  cast: DyCast;
  info?: DyLiveInfo;
  messages: DyMessage[];
  messageIds: Set<string>;
  isConnected: boolean;
  hasError: boolean;
  unreadCount: number;
}

interface RoomManagerEvent extends EventMap {
  roomAdded: (room: RoomInstance) => void;
  roomRemoved: (roomId: string) => void;
  roomConnected: (roomId: string, info?: DyLiveInfo) => void;
  roomDisconnected: (roomId: string) => void;
  roomError: (roomId: string, error: Error) => void;
  roomMessages: (roomId: string, messages: DyMessage[]) => void;
  activeRoomChanged: (roomId: string) => void;
}

export class RoomManager {
  private rooms: Map<string, RoomInstance>;
  private activeRoomId: string | null;
  private emitter: Emitter<RoomManagerEvent>;

  constructor() {
    this.rooms = new Map();
    this.activeRoomId = null;
    this.emitter = new Emitter<RoomManagerEvent>();
  }

  /**
   * 监听事件
   */
  public on<K extends keyof RoomManagerEvent>(event: K, listener: RoomManagerEvent[K]) {
    this.emitter.on(event, listener);
  }

  /**
   * 取消监听
   */
  public off<K extends keyof RoomManagerEvent>(event: K, listener: RoomManagerEvent[K]) {
    this.emitter.off(event, listener);
  }

  /**
   * 添加并连接新房间
   */
  public async addRoom(roomNum: string): Promise<string> {
    CLog.info(`[RoomManager] 开始添加房间: ${roomNum}`);
    
    // 检查房间是否已存在
    const existingRoom = Array.from(this.rooms.values()).find(r => r.roomNum === roomNum);
    if (existingRoom) {
      CLog.info(`房间 ${roomNum} 已存在`);
      this.setActiveRoom(existingRoom.id);
      return existingRoom.id;
    }

    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    CLog.info(`[RoomManager] 创建房间实例: ${roomId}`);
    const cast = new DyCast(roomNum);

    const room: RoomInstance = {
      id: roomId,
      roomNum,
      cast,
      messages: [],
      messageIds: new Set(),
      isConnected: false,
      hasError: false,
      unreadCount: 0
    };

    // 设置事件监听
    CLog.info(`[RoomManager] 设置房间事件监听: ${roomId}`);
    this.setupRoomListeners(room);

    // 添加到房间列表
    this.rooms.set(roomId, room);
    CLog.info(`[RoomManager] 房间已添加到列表，当前房间数: ${this.rooms.size}`);
    this.emitter.emit('roomAdded', room);

    // 设置连接超时检测（15秒）
    const connectTimeout = setTimeout(() => {
      if (!room.isConnected && !room.hasError) {
        CLog.error(`[RoomManager] 房间 ${roomNum} 连接超时`);
        room.hasError = true;
        this.emitter.emit('roomError', roomId, new Error('连接超时'));
      }
    }, 15000);

    // 连接房间
    CLog.info(`[RoomManager] 开始连接房间: ${roomNum} (${roomId})`);
    try {
      await cast.connect();
      CLog.info(`[RoomManager] cast.connect() 调用完成: ${roomNum} (${roomId})`);
    } catch (err) {
      CLog.error(`[RoomManager] 房间 ${roomNum} 连接失败:`, err);
      room.hasError = true;
      clearTimeout(connectTimeout);
    }

    // 如果成功连接，清除超时定时器
    if (room.isConnected) {
      clearTimeout(connectTimeout);
    }

    // 如果没有活动房间，设置为活动房间
    if (!this.activeRoomId) {
      CLog.info(`[RoomManager] 设置为活动房间: ${roomId}`);
      this.setActiveRoom(roomId);
    }

    CLog.info(`[RoomManager] addRoom 完成: ${roomNum} (${roomId})`);
    return roomId;
  }

  /**
   * 设置房间事件监听
   */
  private setupRoomListeners(room: RoomInstance) {
    const { cast, id } = room;

    cast.on('open', (ev, info) => {
      CLog.info(`[RoomManager] 房间 ${room.roomNum} (${id}) open 事件触发`);
      room.isConnected = true;
      room.hasError = false;
      room.info = info;
      CLog.info(`房间 ${room.roomNum} 连接成功`);
      this.emitter.emit('roomConnected', id, info);
    });

    cast.on('error', err => {
      CLog.error(`[RoomManager] 房间 ${room.roomNum} (${id}) error 事件:`, err);
      room.hasError = true;
      CLog.error(`房间 ${room.roomNum} 出错:`, err);
      this.emitter.emit('roomError', id, err);
    });

    cast.on('close', (code, reason) => {
      CLog.info(`[RoomManager] 房间 ${room.roomNum} (${id}) close 事件: [${code}] ${reason}`);
      room.isConnected = false;
      CLog.info(`房间 ${room.roomNum} 已关闭[${code}]: ${reason}`);
      this.emitter.emit('roomDisconnected', id);
    });

    cast.on('message', msgs => {
      // 处理消息去重
      const newMessages: DyMessage[] = [];
      for (const msg of msgs) {
        if (!msg.id || room.messageIds.has(msg.id)) continue;
        room.messageIds.add(msg.id);
        newMessages.push(msg);
      }

      if (newMessages.length > 0) {
        room.messages.push(...newMessages);
        
        // 如果不是当前活动房间，增加未读计数
        if (this.activeRoomId !== id) {
          room.unreadCount += newMessages.length;
        }
        
        this.emitter.emit('roomMessages', id, newMessages);
      }
    });

    cast.on('reconnecting', (count, code, reason) => {
      CLog.warn(`房间 ${room.roomNum} 重连中: ${count}`);
    });

    cast.on('reconnect', ev => {
      CLog.info(`房间 ${room.roomNum} 重连成功`);
    });
  }

  /**
   * 移除房间
   */
  public removeRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // 断开连接
    if (room.isConnected) {
      room.cast.close(1000, '用户主动断开');
    }

    // 从列表移除
    this.rooms.delete(roomId);
    this.emitter.emit('roomRemoved', roomId);

    // 如果是活动房间，切换到其他房间
    if (this.activeRoomId === roomId) {
      const remainingRooms = Array.from(this.rooms.keys());
      if (remainingRooms.length > 0) {
        this.setActiveRoom(remainingRooms[0]);
      } else {
        this.activeRoomId = null;
      }
    }

    CLog.info(`房间 ${room.roomNum} 已移除`);
  }

  /**
   * 设置活动房间
   */
  public setActiveRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) {
      CLog.error(`房间 ${roomId} 不存在`);
      return;
    }

    this.activeRoomId = roomId;
    // 清空未读计数
    room.unreadCount = 0;
    this.emitter.emit('activeRoomChanged', roomId);
    CLog.info(`切换到房间 ${room.roomNum}`);
  }

  /**
   * 获取活动房间
   */
  public getActiveRoom(): RoomInstance | undefined {
    if (!this.activeRoomId) return undefined;
    return this.rooms.get(this.activeRoomId);
  }

  /**
   * 获取活动房间ID
   */
  public getActiveRoomId(): string | null {
    return this.activeRoomId;
  }

  /**
   * 获取指定房间
   */
  public getRoom(roomId: string): RoomInstance | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * 获取所有房间
   */
  public getAllRooms(): RoomInstance[] {
    return Array.from(this.rooms.values());
  }

  /**
   * 获取房间数量
   */
  public getRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * 清空指定房间的消息
   */
  public clearRoomMessages(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.messages = [];
    room.messageIds.clear();
    room.unreadCount = 0;
  }

  /**
   * 清空所有房间
   */
  public clearAll() {
    for (const room of this.rooms.values()) {
      if (room.isConnected) {
        room.cast.close(1000, '清空所有房间');
      }
    }
    this.rooms.clear();
    this.activeRoomId = null;
  }
}

