import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File as ExpoFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  ImageSourcePropType,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';

type Tab = 'home' | 'map' | 'report' | 'success' | 'messages' | 'profile' | 'admin';
type ReportStatus = 'На модерации' | 'Требует уточнения' | 'Передано' | 'В работе' | 'Решено' | 'Отклонено';
type ReportStatusCode = 'moderation' | 'transferred' | 'in_progress' | 'resolved' | 'rejected';
type ReportFilter = 'Все' | 'Активные' | 'Решенные';

type LocationPoint = {
  latitude: number;
  longitude: number;
};

type MapPressEvent = {
  nativeEvent: {
    coordinate: LocationPoint;
  };
};

type MapPoint = LocationPoint & {
  label: string;
  area: string;
  top: `${number}%`;
  left: `${number}%`;
};

type LocationChoice = LocationPoint & {
  label: string;
  area?: string;
};

type Category = {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  hint: string;
  evidenceTip: string;
  pointsPreview: number;
};

type Report = {
  id: number;
  publicId: string;
  title: string;
  category: string;
  location: string;
  latitude: number;
  longitude: number;
  status: ReportStatus;
  statusCode: ReportStatusCode;
  nextStep: string;
  authorityLabel: string;
  nextActionLabel: string;
  date: string;
  points: number;
  confirmations: number;
  evidenceScore: number;
  canConfirm: boolean;
  canDisputeResolution: boolean;
  image: ImageSourcePropType;
  timeline: Array<{ label: string; done: boolean }>;
};

type ApiReport = {
  id: string;
  title: string;
  category: string;
  description?: string;
  locationText: string;
  latitude: number;
  longitude: number;
  status: {
    code: ReportStatusCode;
    label: ReportStatus;
    hint: string;
    terminal: boolean;
  };
  nextStep: string;
  points: number;
  confirmations: number;
  photoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  adminAction?: string;
};

type ApiReward = {
  id: string;
  title: string;
  partner: string;
  cost: number;
  benefit: string;
  note: string;
};

type RewardClaim = {
  id: string;
  profileId: string;
  rewardId: string;
  code: string;
  pointsSpent: number;
  status: string;
  createdAt: string;
};

type ProfileSummary = {
  id: string;
  balance: number;
  earned: number;
  spent: number;
  resolved: number;
  confirmations: number;
  availableRewards: string[];
  claimedRewards: RewardClaim[];
  nextReward: ApiReward | null;
};

type AdminUser = {
  id: string;
  username: string;
  profileId: string;
  createdAt: string;
  lastSeenAt: string | null;
  balance: number;
  earned: number;
  spent: number;
  reports: number;
  activeReports: number;
  resolvedReports: number;
  claimedRewards: number;
};

type AdminPromoCode = RewardClaim & {
  rewardTitle: string;
  rewardPartner: string;
};

type AuthUser = {
  id: string;
  username: string;
  profileId: string;
  createdAt: string;
};

type AuthPayload = {
  token: string;
  user: AuthUser;
};

type ApiUpload = {
  url: string;
  path: string;
  contentType: string;
  size: number;
};

type Reward = {
  id: string;
  title: string;
  partner: string;
  cost: number;
  benefit: string;
  note: string;
  image: ImageSourcePropType;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
};

const heroImage = require('./assets/baikal/hero-clean.png');
const reportImage = require('./assets/baikal/report-clean.png');
const rewardImage = require('./assets/baikal/rewards-clean.png');
const onboardingPages: Array<{
  title: string;
  text: string;
  image: ImageSourcePropType;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  accent: string;
}> = [
  {
    title: 'Заметили проблему у Байкала?',
    text: 'Снимите фото, выберите место на карте и отправьте короткое описание. Без лишних анкет.',
    image: heroImage,
    icon: 'camera-outline',
    accent: '#008F9A',
  },
  {
    title: 'Мы ведем заявку по шагам',
    text: 'Видно, где обращение: проверка, передача ответственным, работа или решение.',
    image: reportImage,
    icon: 'map-marker-check-outline',
    accent: '#247647',
  },
  {
    title: 'Полезные действия дают листики',
    text: 'Фото, подтверждения и решенные проблемы превращаются в бонусы у партнеров.',
    image: rewardImage,
    icon: 'gift-outline',
    accent: '#008F9A',
  },
];
const DRAFT_STORAGE_KEY = 'baikal-report-draft-v1';
const PROFILE_STORAGE_KEY = 'baikal-profile-id-v1';
const AUTH_STORAGE_KEY = 'baikal-auth-v1';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const ADMIN_ENABLED = process.env.EXPO_PUBLIC_ADMIN_ENABLED === 'true';
const INITIAL_ADMIN_TOKEN = process.env.EXPO_PUBLIC_ADMIN_TOKEN || '';
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL || '';
const SUPPORT_URL = process.env.EXPO_PUBLIC_SUPPORT_URL || '';
const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL || '';
const noWebOutline = { outlineStyle: 'none' } as unknown as ViewStyle;
const NativeMaps = Platform.OS === 'web' ? null : require('react-native-maps');
const MapView = NativeMaps?.default;
const Marker = NativeMaps?.Marker;
const Callout = NativeMaps?.Callout;
const PROVIDER_GOOGLE = NativeMaps?.PROVIDER_GOOGLE;

const mapPoints: MapPoint[] = [
  { label: 'Большое Голоустное', area: 'лесной участок у берега', latitude: 52.03582, longitude: 105.40611, top: '26%', left: '62%' },
  { label: 'Листвянка', area: 'береговая линия', latitude: 51.85347, longitude: 104.86931, top: '50%', left: '30%' },
  { label: 'Ольхон', area: 'тропа у мыса', latitude: 53.15912, longitude: 107.38391, top: '68%', left: '54%' },
];

const categories: Category[] = [
  { label: 'Вырубка', icon: 'pine-tree', hint: 'лес, просеки, техника', evidenceTip: 'Снимите пни, следы техники и общий план участка.', pointsPreview: 70 },
  { label: 'Мусор', icon: 'trash-can-outline', hint: 'берег, тропы, места отдыха', evidenceTip: 'Покажите масштаб мусора и ближайший ориентир.', pointsPreview: 50 },
  { label: 'Свалка', icon: 'dump-truck', hint: 'крупный мусор', evidenceTip: 'Снимите общий объем, подъезд и опасные предметы.', pointsPreview: 80 },
  { label: 'Вода', icon: 'water-outline', hint: 'загрязнение воды', evidenceTip: 'Покажите цвет воды, источник загрязнения и берег.', pointsPreview: 80 },
  { label: 'Стройка', icon: 'office-building-cog-outline', hint: 'работы без табличек', evidenceTip: 'Снимите технику, ограждение, таблички или их отсутствие.', pointsPreview: 60 },
  { label: 'Разлив', icon: 'oil', hint: 'топливо, пятна', evidenceTip: 'Покажите пятно, источник и расстояние до воды.', pointsPreview: 90 },
  { label: 'Природа', icon: 'leaf', hint: 'повреждение троп', evidenceTip: 'Снимите повреждение и место, где его легко найти.', pointsPreview: 50 },
  { label: 'Другое', icon: 'dots-horizontal', hint: 'другая ситуация', evidenceTip: 'Опишите, что произошло, и добавьте понятный ориентир.', pointsPreview: 40 },
];

const initialRewards: Reward[] = [
  { id: 'tea-by-the-lake', title: 'Чай у озера', partner: 'Кафе «У Озера»', cost: 350, benefit: 'напиток в подарок', note: 'забрать сегодня', image: rewardImage, icon: 'coffee-outline' },
  { id: 'bike-rental', title: 'Прокат велосипеда', partner: 'Листвянка Bike', cost: 800, benefit: '-20% на прогулку', note: '2 часа по берегу', image: heroImage, icon: 'bike' },
  { id: 'eco-hotel', title: 'Эко-отель', partner: 'Байкал Дом', cost: 1200, benefit: '-10% на ночь', note: 'для выходных', image: rewardImage, icon: 'home-heart' },
];

const initialReports: Report[] = [
  {
    id: 1,
    publicId: 'BR-1024',
    title: 'Незаконная вырубка леса',
    category: 'Вырубка',
    location: 'Большое Голоустное',
    latitude: 52.03582,
    longitude: 105.40611,
    status: 'В работе',
    statusCode: 'in_progress',
    nextStep: 'Ответственные службы проверяют участок',
    authorityLabel: 'Лесной надзор',
    nextActionLabel: 'Ожидаем акт проверки',
    date: '12.05.2026',
    points: 50,
    confirmations: 4,
    evidenceScore: 86,
    canConfirm: true,
    canDisputeResolution: false,
    image: reportImage,
    timeline: [
      { label: 'Сообщение получено', done: true },
      { label: 'Фото и место проверены', done: true },
      { label: 'Передано ответственным', done: true },
      { label: 'Проверка на месте', done: true },
      { label: 'Ожидаем результат', done: false },
    ],
  },
  {
    id: 2,
    publicId: 'BR-1018',
    title: 'Мусор на берегу',
    category: 'Мусор',
    location: 'Листвянка',
    latitude: 51.85347,
    longitude: 104.86931,
    status: 'Передано',
    statusCode: 'transferred',
    nextStep: 'Заявка направлена координатору района',
    authorityLabel: 'Координатор района',
    nextActionLabel: 'Назначить исполнителя',
    date: '10.05.2026',
    points: 20,
    confirmations: 2,
    evidenceScore: 72,
    canConfirm: true,
    canDisputeResolution: false,
    image: heroImage,
    timeline: [
      { label: 'Сообщение получено', done: true },
      { label: 'Проверено модератором', done: true },
      { label: 'Передано координатору', done: true },
      { label: 'Назначение исполнителя', done: false },
    ],
  },
  {
    id: 3,
    publicId: 'BR-1007',
    title: 'Поврежденная тропа восстановлена',
    category: 'Природа',
    location: 'Ольхон',
    latitude: 53.15912,
    longitude: 107.38391,
    status: 'Решено',
    statusCode: 'resolved',
    nextStep: 'Листики начислены, заявка закрыта',
    authorityLabel: 'Команда проекта',
    nextActionLabel: 'Оцените результат',
    date: '02.05.2026',
    points: 100,
    confirmations: 7,
    evidenceScore: 94,
    canConfirm: false,
    canDisputeResolution: true,
    image: rewardImage,
    timeline: [
      { label: 'Сообщение получено', done: true },
      { label: 'Проверено модератором', done: true },
      { label: 'Передано ответственным', done: true },
      { label: 'Проблема устранена', done: true },
      { label: 'Листики начислены', done: true },
    ],
  },
];

const statusTimeline: Record<ReportStatusCode, string[]> = {
  moderation: ['Сообщение получено'],
  transferred: ['Сообщение получено', 'Фото и место проверены', 'Передано ответственным'],
  in_progress: ['Сообщение получено', 'Фото и место проверены', 'Передано ответственным', 'Проверка на месте'],
  resolved: ['Сообщение получено', 'Фото и место проверены', 'Передано ответственным', 'Проблема устранена', 'Листики начислены'],
  rejected: ['Сообщение получено', 'Проверка завершена'],
};

const fullTimeline = ['Сообщение получено', 'Фото и место проверены', 'Передано ответственным', 'Проверка на месте', 'Результат и листики'];

function reportNumericId(publicId: string) {
  const numeric = Number(publicId.replace(/\D/g, ''));
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function formatReportDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function reportFromApi(report: ApiReport): Report {
  const doneLabels = statusTimeline[report.status.code] ?? statusTimeline.moderation;
  const category = categories.find((item) => item.label === report.category);

  return {
    id: reportNumericId(report.id),
    publicId: report.id,
    title: report.title,
    category: report.category,
    location: report.locationText,
    latitude: report.latitude,
    longitude: report.longitude,
    status: report.status.label,
    statusCode: report.status.code,
    nextStep: report.nextStep || report.status.hint,
    authorityLabel: report.adminAction ? 'Админка проекта' : 'Модерация проекта',
    nextActionLabel: report.adminAction || report.status.hint,
    date: formatReportDate(report.createdAt),
    points: report.points,
    confirmations: report.confirmations,
    evidenceScore: Math.min(98, 62 + report.confirmations * 6 + (report.photoUrl ? 16 : 0)),
    canConfirm: !report.status.terminal,
    canDisputeResolution: report.status.code === 'resolved',
    image: report.photoUrl ? { uri: report.photoUrl } : category?.label === 'Мусор' ? heroImage : reportImage,
    timeline: fullTimeline.map((label) => ({ label, done: doneLabels.includes(label) })),
  };
}

function rewardFromApi(reward: ApiReward): Reward {
  const local = initialRewards.find((item) => item.id === reward.id);
  return {
    id: reward.id,
    title: reward.title,
    partner: reward.partner,
    cost: reward.cost,
    benefit: reward.benefit,
    note: reward.note,
    image: local?.image ?? rewardImage,
    icon: local?.icon ?? 'gift-outline',
  };
}

async function requestJson<T>(path: string, options?: RequestInit & { profileId?: string | null; authToken?: string | null }): Promise<T> {
  const { profileId, authToken, ...fetchOptions } = options ?? {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers: {
      'content-type': 'application/json',
      ...(profileId ? { 'x-profile-id': profileId } : {}),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(options?.headers ?? {}),
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'API request failed');
  }

  return payload as T;
}

function inferImageContentType(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.includes('image/png') || lower.endsWith('.png')) return 'image/png';
  if (lower.includes('image/webp') || lower.endsWith('.webp')) return 'image/webp';
  if (lower.includes('image/heic') || lower.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}

function createLocalProfileId() {
  return `device:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function imageUriToBase64(uri: string) {
  const dataUrlMatch = uri.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (dataUrlMatch) return dataUrlMatch[2];

  const file = new ExpoFile(uri);
  return file.base64();
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [selectedCategory, setSelectedCategory] = useState(categories[0].label);
  const [description, setDescription] = useState('');
  const [reports, setReports] = useState(initialReports);
  const [rewardCatalog, setRewardCatalog] = useState(initialRewards);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminPromoCodes, setAdminPromoCodes] = useState<AdminPromoCode[]>([]);
  const [adminAuthToken, setAdminAuthToken] = useState(INITIAL_ADMIN_TOKEN);
  const [adminAuthMessage, setAdminAuthMessage] = useState('');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [lastClaim, setLastClaim] = useState<RewardClaim | null>(null);
  const [confirmedReportIds, setConfirmedReportIds] = useState<Set<string>>(new Set());
  const [submittedReport, setSubmittedReport] = useState<Report | null>(null);
  const [pickedImage, setPickedImage] = useState<string | null>(null);
  const [pickedLocation, setPickedLocation] = useState<LocationPoint | null>(null);
  const [pickedLocationLabel, setPickedLocationLabel] = useState('');
  const [selectedReportId, setSelectedReportId] = useState(initialReports[0].id);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Данные еще не обновлялись');
  const [isSyncing, setIsSyncing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const balance = useMemo(
    () => profileSummary?.balance ?? 1250 + reports.reduce((sum, report) => sum + report.points, 0) - initialReports.reduce((sum, report) => sum + report.points, 0),
    [profileSummary?.balance, reports],
  );

  useEffect(() => {
    const loadDraft = async () => {
      try {
        const storedDraft = await AsyncStorage.getItem(DRAFT_STORAGE_KEY);
        if (!storedDraft) return;

        const draft = JSON.parse(storedDraft) as {
          selectedCategory?: string;
          description?: string;
          pickedImage?: string | null;
          pickedLocation?: LocationPoint | null;
          pickedLocationLabel?: string;
        };

        if (draft.selectedCategory && categories.some((item) => item.label === draft.selectedCategory)) {
          setSelectedCategory(draft.selectedCategory);
        }
        if (typeof draft.description === 'string') setDescription(draft.description);
        if (typeof draft.pickedImage === 'string') setPickedImage(draft.pickedImage);
        if (typeof draft.pickedLocation?.latitude === 'number' && typeof draft.pickedLocation?.longitude === 'number') {
          setPickedLocation(draft.pickedLocation);
        }
        if (typeof draft.pickedLocationLabel === 'string') setPickedLocationLabel(draft.pickedLocationLabel);
      } finally {
        setDraftLoaded(true);
      }
    };

    loadDraft();
  }, []);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const storedAuth = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (!storedAuth) return;

        const parsed = JSON.parse(storedAuth) as Partial<AuthPayload>;
        if (!parsed.token) return;

        const payload = await requestJson<{ user: AuthUser }>('/api/auth/me', { authToken: parsed.token });
        setAuthToken(parsed.token);
        setAuthUser(payload.user);
        setProfileId(payload.user.profileId);
        await AsyncStorage.setItem(PROFILE_STORAGE_KEY, payload.user.profileId);
      } catch {
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      } finally {
        setAuthLoaded(true);
      }
    };

    loadAuth().catch(() => setAuthLoaded(true));
  }, []);

  useEffect(() => {
    if (!authLoaded || authUser) return;

    const loadProfile = async () => {
      const storedProfileId = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
      if (storedProfileId) {
        setProfileId(storedProfileId);
        return;
      }

      const nextProfileId = createLocalProfileId();
      await AsyncStorage.setItem(PROFILE_STORAGE_KEY, nextProfileId);
      setProfileId(nextProfileId);
    };

    loadProfile().catch(() => setProfileId('demo-profile'));
  }, [authLoaded, authUser]);

  useEffect(() => {
    if (!draftLoaded) return;

    AsyncStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ selectedCategory, description, pickedImage, pickedLocation, pickedLocationLabel }),
    ).catch(() => undefined);
  }, [description, draftLoaded, pickedImage, pickedLocation, pickedLocationLabel, selectedCategory]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeTab]);

  const loadReportsFromApi = async () => {
    if (!profileId) return;
    setIsSyncing(true);
    try {
      const [reportPayload, rewardsPayload, profilePayload] = await Promise.all([
        requestJson<{ reports: ApiReport[] }>('/api/reports', { profileId, authToken }),
        requestJson<{ rewards: ApiReward[] }>('/api/rewards', { profileId, authToken }),
        requestJson<{ profile: ProfileSummary }>('/api/me/summary', { profileId, authToken }),
      ]);
      const apiReports = reportPayload.reports.map(reportFromApi);
      setReports(apiReports.length > 0 ? apiReports : initialReports);
      if (apiReports[0]) setSelectedReportId(apiReports[0].id);
      setRewardCatalog(rewardsPayload.rewards.map(rewardFromApi));
      setProfileSummary(profilePayload.profile);
      setSyncMessage(apiReports.length > 0 ? 'Данные обновлены' : 'Заявок пока нет');
    } catch {
      setSyncMessage('Нет связи с сервером. Показываем сохраненные данные.');
    } finally {
      setIsSyncing(false);
    }
  };

  const loadAdminDashboardFromApi = async () => {
    if (!ADMIN_ENABLED || !adminAuthToken) {
      setAdminUsers([]);
      setAdminPromoCodes([]);
      return;
    }

    try {
      const payload = await requestJson<{ users: AdminUser[]; promoCodes: AdminPromoCode[]; rewards: ApiReward[] }>('/api/admin/db', {
        headers: {
          authorization: `Bearer ${adminAuthToken}`,
        },
      });
      setAdminUsers(payload.users);
      setAdminPromoCodes(payload.promoCodes);
      setRewardCatalog(payload.rewards.map(rewardFromApi));
    } catch (error) {
      setAdminUsers([]);
      setAdminPromoCodes([]);
      setSyncMessage(error instanceof Error ? error.message : 'Не удалось загрузить пользователей');
    }
  };

  useEffect(() => {
    loadReportsFromApi();
    loadAdminDashboardFromApi();
  }, [authToken, profileId, adminAuthToken]);

  const submitAdminLogin = async (username: string, password: string) => {
    setAdminAuthMessage('');
    const payload = await requestJson<{ token: string }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setAdminAuthToken(payload.token);
    setSyncMessage('Админка подключена');
  };

  const createAdminPromoCode = async (profileId: string, rewardId: string) => {
    const payload = await requestJson<{ db: { users: AdminUser[]; promoCodes: AdminPromoCode[]; rewards: ApiReward[] } }>('/api/admin/promo-codes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuthToken}`,
      },
      body: JSON.stringify({ profileId, rewardId }),
    });
    setAdminUsers(payload.db.users);
    setAdminPromoCodes(payload.db.promoCodes);
    setRewardCatalog(payload.db.rewards.map(rewardFromApi));
    setSyncMessage('Промокод создан');
  };

  const completeAuth = async (payload: AuthPayload) => {
    setAuthToken(payload.token);
    setAuthUser(payload.user);
    setProfileId(payload.user.profileId);
    setAuthMessage('');
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    await AsyncStorage.setItem(PROFILE_STORAGE_KEY, payload.user.profileId);
  };

  const submitAuth = async (mode: 'register' | 'login', username: string, password: string) => {
    setAuthMessage('');
    const payload = await requestJson<AuthPayload>(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    await completeAuth(payload);
  };

  const logout = async () => {
    setAuthToken(null);
    setAuthUser(null);
    setProfileSummary(null);
    setLastClaim(null);
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
  };

  const clearDraft = () => {
    setSelectedCategory(categories[0].label);
    setDescription('');
    setPickedImage(null);
    setPickedLocation(null);
    setPickedLocationLabel('');
    AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => undefined);
  };

  const buildLocalReport = (publicId?: string): Report => {
    const category = categories.find((item) => item.label === selectedCategory) ?? categories[0];
    const evidenceScore = Math.min(96, 42 + (pickedImage ? 26 : 0) + (description.trim().length >= 35 ? 14 : 8) + (pickedLocation ? 14 : 0));

    return {
      id: publicId ? reportNumericId(publicId) : Date.now(),
      publicId: publicId ?? `BR-${Math.floor(1200 + Math.random() * 7800)}`,
      title: category.label === 'Вырубка' ? 'Незаконная вырубка леса' : `Обращение: ${category.label}`,
      category: category.label,
      location: pickedLocation ? pickedLocationLabel || 'Выбранная точка' : 'Иркутская область',
      latitude: pickedLocation?.latitude ?? 52.28697,
      longitude: pickedLocation?.longitude ?? 104.30502,
      status: 'На модерации',
      statusCode: 'moderation',
      nextStep: 'Модератор проверит фото, описание и место',
      authorityLabel: 'Модерация проекта',
      nextActionLabel: 'Проверка доказательств',
      date: new Intl.DateTimeFormat('ru-RU').format(new Date()),
      points: category.pointsPreview,
      confirmations: 0,
      evidenceScore,
      canConfirm: false,
      canDisputeResolution: false,
      image: pickedImage ? { uri: pickedImage } : reportImage,
      timeline: [
        { label: 'Сообщение получено', done: true },
        { label: 'Проверка фото и места', done: false },
        { label: 'Передача ответственным', done: false },
        { label: 'Работа по обращению', done: false },
        { label: 'Результат и листики', done: false },
      ],
    };
  };

  const submitReport = async () => {
    const localReport = buildLocalReport();
    let nextReport = localReport;
    const activeProfileId = profileId ?? 'demo-profile';

    try {
      let uploadedPhotoUrl = pickedImage;
      if (pickedImage && !pickedImage.startsWith('http')) {
        const uploadPayload = await requestJson<{ upload: ApiUpload }>('/api/uploads', {
          method: 'POST',
          profileId: activeProfileId,
          authToken,
          body: JSON.stringify({
            contentType: inferImageContentType(pickedImage),
            dataBase64: await imageUriToBase64(pickedImage),
          }),
        });
        uploadedPhotoUrl = uploadPayload.upload.url;
      }

      const payload = await requestJson<{ report: ApiReport }>('/api/reports', {
        method: 'POST',
        profileId: activeProfileId,
        authToken,
        body: JSON.stringify({
          title: localReport.title,
          category: localReport.category,
          description,
          locationText: localReport.location,
          latitude: pickedLocation?.latitude ?? 52.28697,
          longitude: pickedLocation?.longitude ?? 104.30502,
          photoUrl: uploadedPhotoUrl,
        }),
      });
      nextReport = reportFromApi(payload.report);
      setSyncMessage('Заявка отправлена');
    } catch {
      setSyncMessage('Нет связи с сервером. Заявка сохранена на устройстве.');
    }

    setReports([nextReport, ...reports]);
    requestJson<{ profile: ProfileSummary }>('/api/me/summary', { profileId: activeProfileId, authToken })
      .then((payload) => setProfileSummary(payload.profile))
      .catch(() => undefined);
    setSubmittedReport(nextReport);
    setSelectedReportId(nextReport.id);
    clearDraft();
    setActiveTab('success');
  };

  const confirmReport = async (report: Report) => {
    if (confirmedReportIds.has(report.publicId) || !report.canConfirm) return;
    setConfirmedReportIds((items) => new Set(items).add(report.publicId));
    const activeProfileId = profileId ?? 'demo-profile';

    try {
      const payload = await requestJson<{ report: ApiReport }>(`/api/reports/${report.publicId}/confirm`, {
        method: 'POST',
        profileId: activeProfileId,
        authToken,
      });
      const updated = reportFromApi(payload.report);
      setReports((items) => items.map((item) => (item.publicId === updated.publicId ? updated : item)));
      requestJson<{ profile: ProfileSummary }>('/api/me/summary', { profileId: activeProfileId, authToken })
        .then((summaryPayload) => setProfileSummary(summaryPayload.profile))
        .catch(() => undefined);
      setSyncMessage(`Подтверждение ${updated.publicId} учтено`);
    } catch {
      const updated = {
        ...report,
        confirmations: report.confirmations + 1,
        evidenceScore: Math.min(98, report.evidenceScore + 6),
      };
      setReports((items) => items.map((item) => (item.publicId === updated.publicId ? updated : item)));
      setSyncMessage('Нет связи с сервером. Подтверждение сохранено на устройстве.');
    }
  };

  const claimReward = async (reward: Reward) => {
    const activeProfileId = profileId ?? 'demo-profile';
    try {
      const payload = await requestJson<{ claim: RewardClaim; profile: ProfileSummary }>(`/api/rewards/${reward.id}/claim`, {
        method: 'POST',
        profileId: activeProfileId,
        authToken,
      });
      setProfileSummary(payload.profile);
      setLastClaim(payload.claim);
      setSyncMessage(`Бонус ${reward.title} забронирован`);
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Не удалось забрать бонус');
    }
  };

  if (!authLoaded) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.shell}>
          <View style={styles.authScreen}>
            <Text style={styles.authTitle}>Байкал</Text>
            <Text style={styles.authText}>Готовим профиль участника...</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!authUser) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <AuthScreen
          message={authMessage}
          onSubmit={(mode, username, password) =>
            submitAuth(mode, username, password).catch((error) => setAuthMessage(error instanceof Error ? error.message : 'Не удалось войти'))
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.shell}>
        <ScrollView key={activeTab} ref={scrollRef} style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
          {activeTab === 'home' && (
            <HomeScreen
              balance={balance}
              reports={reports}
              rewards={rewardCatalog}
              claimedRewards={profileSummary?.claimedRewards ?? []}
              onReport={() => setActiveTab('report')}
              onOpenReports={() => setActiveTab('messages')}
              onClaimReward={claimReward}
            />
          )}
          {activeTab === 'map' && <MapScreen reports={reports} confirmedReportIds={confirmedReportIds} onConfirmReport={confirmReport} />}
          {activeTab === 'report' && (
            <ReportScreen
              reports={reports}
              description={description}
              selectedCategory={selectedCategory}
              pickedImage={pickedImage}
              pickedLocation={pickedLocation}
              pickedLocationLabel={pickedLocationLabel}
              onChangeDescription={setDescription}
              onSelectCategory={setSelectedCategory}
              onPickImage={setPickedImage}
              onPickLocation={setPickedLocation}
              onPickLocationLabel={setPickedLocationLabel}
              onSubmit={submitReport}
              onClearDraft={clearDraft}
              onOpenDuplicate={(id) => {
                setSelectedReportId(id);
                setActiveTab('messages');
              }}
            />
          )}
          {activeTab === 'success' && submittedReport && (
            <SuccessScreen report={submittedReport} onMessages={() => setActiveTab('messages')} onAnother={() => setActiveTab('report')} />
          )}
          {activeTab === 'messages' && (
            <MessagesScreen
              reports={reports}
              selectedReportId={selectedReportId}
              onSelectReport={setSelectedReportId}
              confirmedReportIds={confirmedReportIds}
              onConfirmReport={confirmReport}
            />
          )}
          {activeTab === 'profile' && (
            <ProfileScreen
              balance={balance}
              reports={reports}
              rewards={rewardCatalog}
              claimedRewards={profileSummary?.claimedRewards ?? []}
              lastClaim={lastClaim}
              username={authUser.username}
              onClaimReward={claimReward}
              onLogout={logout}
            />
          )}
          {ADMIN_ENABLED && activeTab === 'admin' && (
            <AdminScreen
              reports={reports}
              users={adminUsers}
              rewards={rewardCatalog}
              promoCodes={adminPromoCodes}
              syncMessage={syncMessage}
              isSyncing={isSyncing}
              adminReady={Boolean(adminAuthToken)}
              authMessage={adminAuthMessage}
              onAdminLogin={(username, password) =>
                submitAdminLogin(username, password).catch((error) =>
                  setAdminAuthMessage(error instanceof Error ? error.message : 'Не удалось войти'),
                )
              }
              onRefresh={() => {
                loadReportsFromApi();
                loadAdminDashboardFromApi();
              }}
              onCreatePromoCode={createAdminPromoCode}
              onStatusChange={async (report, statusCode) => {
                try {
                  const payload = await requestJson<{ report: ApiReport }>(`/api/admin/reports/${report.publicId}/status`, {
                    method: 'POST',
                    headers: {
                      'x-admin-id': 'admin:mobile-web',
                      ...(adminAuthToken ? { authorization: `Bearer ${adminAuthToken}` } : {}),
                    },
                    body: JSON.stringify({ status: statusCode }),
                  });
                  const updated = reportFromApi(payload.report);
                  setReports((items) => items.map((item) => (item.publicId === updated.publicId ? updated : item)));
                  setSelectedReportId(updated.id);
                  setSyncMessage(`Статус ${updated.publicId}: ${updated.status}`);
                  loadReportsFromApi();
                  loadAdminDashboardFromApi();
                } catch (error) {
                  setSyncMessage(error instanceof Error ? error.message : 'Не удалось сменить статус');
                }
              }}
            />
          )}
        </ScrollView>
        <BottomNav activeTab={activeTab} onChange={setActiveTab} />
      </View>
    </SafeAreaView>
  );
}

function HomeScreen({
  balance,
  reports,
  rewards,
  claimedRewards,
  onReport,
  onOpenReports,
  onClaimReward,
}: {
  balance: number;
  reports: Report[];
  rewards: Reward[];
  claimedRewards: RewardClaim[];
  onReport: () => void;
  onOpenReports: () => void;
  onClaimReward: (reward: Reward) => void;
}) {
  const activeReports = reports.filter((report) => report.status !== 'Решено' && report.status !== 'Отклонено').length;
  const solvedReports = reports.filter((report) => report.status === 'Решено').length;
  const newestReport = reports[0];
  const verifiedReports = reports.filter((report) => report.status === 'В работе' || report.status === 'Решено').length;

  return (
    <View style={styles.screen}>
      <AppHeader title="Байкал" rightText={`${balance} листиков`} />

      <View style={styles.heroBlock}>
        <Image source={heroImage} style={styles.heroImage} resizeMode="cover" />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,58,66,0.66)']} style={styles.heroOverlay} />
        <View style={styles.heroContent}>
          <View style={styles.heroPill}>
            <MaterialCommunityIcons name="shield-check-outline" size={15} color="#ffffff" />
            <Text style={styles.heroPillText}>Контакты не показываются публично</Text>
          </View>
          <Text style={styles.heroTitle}>Сообщите о проблеме на Байкале</Text>
          <Text style={styles.heroText}>Фото, место и короткое описание помогут быстрее проверить обращение.</Text>
          <Pressable style={styles.heroButton} onPress={onReport}>
            <Text style={styles.heroButtonText}>Сообщить о проблеме</Text>
            <MaterialCommunityIcons name="arrow-right" size={18} color="#141414" />
          </Pressable>
        </View>
      </View>

      <WorkflowStrip />
      <EmergencyNotice />

      <RewardsSection balance={balance} rewards={rewards} claimedRewards={claimedRewards} onClaimReward={onClaimReward} compact />

      <View style={styles.summaryGrid}>
        <SummaryCell label="Активно" value={`${activeReports}`} />
        <SummaryCell label="Проверено" value={`${verifiedReports}`} />
        <SummaryCell label="Решено" value={`${solvedReports}`} />
      </View>

      <SectionHeader title="Последняя заявка" action="Все" onAction={onOpenReports} />
      <View style={styles.listPanel}>
        <ReportRow report={newestReport} />
      </View>
    </View>
  );
}

function AuthScreen({
  message,
  onSubmit,
}: {
  message: string;
  onSubmit: (mode: 'register' | 'login', username: string, password: string) => void;
}) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [pageIndex, setPageIndex] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const usernameReady = /^[a-z0-9_.-]{3,24}$/.test(username.trim().toLowerCase());
  const passwordReady = password.length >= 6;
  const canSubmit = usernameReady && passwordReady;
  const isOnboarding = pageIndex < onboardingPages.length;

  if (isOnboarding) {
    const page = onboardingPages[pageIndex];
    const isLastPage = pageIndex === onboardingPages.length - 1;

    return (
      <ScrollView style={styles.authShell} contentContainerStyle={styles.authScrollInner} showsVerticalScrollIndicator={false}>
        <View style={styles.onboardingTop}>
          <Text style={styles.onboardingBrand}>Байкал</Text>
          <Pressable style={styles.onboardingSkip} onPress={() => setPageIndex(onboardingPages.length)}>
            <Text style={styles.onboardingSkipText}>Войти</Text>
          </Pressable>
        </View>

        <View style={styles.onboardingCard}>
          <Image source={page.image} style={styles.onboardingImage} resizeMode="cover" />
          <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,64,70,0.82)']} style={styles.authHeroOverlay} />
          <View style={styles.onboardingImageContent}>
            <View style={[styles.onboardingIcon, { backgroundColor: page.accent }]}>
              <MaterialCommunityIcons name={page.icon} size={24} color="#ffffff" />
            </View>
            <Text style={styles.onboardingTitle}>{page.title}</Text>
            <Text style={styles.onboardingText}>{page.text}</Text>
          </View>
        </View>

        <View style={styles.onboardingDots}>
          {onboardingPages.map((item, index) => (
            <Pressable
              key={item.title}
              accessibilityRole="button"
              accessibilityLabel={`Экран ${index + 1}`}
              style={[styles.onboardingDot, index === pageIndex && styles.onboardingDotActive]}
              onPress={() => setPageIndex(index)}
            />
          ))}
        </View>

        <View style={styles.onboardingActions}>
          <Pressable
            style={styles.onboardingSecondaryButton}
            onPress={() => setPageIndex(Math.max(0, pageIndex - 1))}
            disabled={pageIndex === 0}
          >
            <Text style={[styles.onboardingSecondaryText, pageIndex === 0 && styles.onboardingSecondaryTextDisabled]}>Назад</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, styles.onboardingPrimaryButton]}
            onPress={() => {
              if (isLastPage) {
                setMode('register');
                setPageIndex(onboardingPages.length);
                return;
              }
              setPageIndex(pageIndex + 1);
            }}
          >
            <Text style={styles.primaryButtonText}>{isLastPage ? 'Создать профиль' : 'Дальше'}</Text>
            <MaterialCommunityIcons name="arrow-right" size={18} color="#ffffff" />
          </Pressable>
        </View>

        <Pressable
          style={styles.onboardingLoginLine}
          onPress={() => {
            setMode('login');
            setPageIndex(onboardingPages.length);
          }}
        >
          <Text style={styles.onboardingLoginText}>Уже есть аккаунт</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.authShell} contentContainerStyle={styles.authScrollInner} showsVerticalScrollIndicator={false}>
      <View style={styles.authCompactHero}>
        <Image source={rewardImage} style={styles.authHeroImage} resizeMode="cover" />
        <LinearGradient colors={['rgba(0,0,0,0.08)', 'rgba(0,72,78,0.80)']} style={styles.authHeroOverlay} />
        <View style={styles.authCompactHeroContent}>
          <View style={styles.heroPill}>
            <MaterialCommunityIcons name="shield-lock-outline" size={15} color="#ffffff" />
            <Text style={styles.heroPillText}>Заявки и листики сохраняются</Text>
          </View>
          <Text style={styles.authTitle}>{mode === 'register' ? 'Создайте профиль' : 'Войдите в профиль'}</Text>
          <Text style={styles.authText}>Нужны только username и пароль. Контакты не показываются публично.</Text>
        </View>
      </View>

      <View style={styles.authPanel}>
        <View style={styles.authModeRow}>
          <Pressable style={[styles.authModeButton, mode === 'register' && styles.authModeButtonActive]} onPress={() => setMode('register')}>
            <Text style={[styles.authModeText, mode === 'register' && styles.authModeTextActive]}>Создать</Text>
          </Pressable>
          <Pressable style={[styles.authModeButton, mode === 'login' && styles.authModeButtonActive]} onPress={() => setMode('login')}>
            <Text style={[styles.authModeText, mode === 'login' && styles.authModeTextActive]}>Войти</Text>
          </Pressable>
        </View>

        <Text style={styles.authLabel}>Username</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="например, baikal_ivan"
          placeholderTextColor="#8b8b8b"
          style={styles.authInput}
        />
        <Text style={styles.authFieldHint}>Латиница, цифры, точка, дефис или нижнее подчеркивание.</Text>

        <Text style={styles.authLabel}>Пароль</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="минимум 6 символов"
          placeholderTextColor="#8b8b8b"
          style={styles.authInput}
        />

        {message ? <Text style={styles.authError}>{message}</Text> : null}

        <Pressable
          style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
          onPress={canSubmit ? () => onSubmit(mode, username.trim().toLowerCase(), password) : undefined}
        >
          <Text style={styles.primaryButtonText}>{mode === 'register' ? 'Создать профиль' : 'Войти'}</Text>
        </Pressable>

        <View style={styles.authBenefitList}>
          <InfoRow icon="clipboard-check-outline" title="Заявки сохраняются" text="Все обращения будут привязаны к вашему аккаунту." />
          <InfoRow icon="leaf" title="Листики не теряются" text="Баланс и бонусы подтянутся после входа." />
          <InfoRow icon="eye-off-outline" title="Контакты не публичны" text="В заявках виден служебный профиль, не личные данные." />
        </View>
      </View>
    </ScrollView>
  );
}

function ReportScreen({
  reports,
  description,
  selectedCategory,
  pickedImage,
  pickedLocation,
  pickedLocationLabel,
  onChangeDescription,
  onSelectCategory,
  onPickImage,
  onPickLocation,
  onPickLocationLabel,
  onSubmit,
  onClearDraft,
  onOpenDuplicate,
}: {
  reports: Report[];
  description: string;
  selectedCategory: string;
  pickedImage: string | null;
  pickedLocation: LocationPoint | null;
  pickedLocationLabel: string;
  onChangeDescription: (value: string) => void;
  onSelectCategory: (value: string) => void;
  onPickImage: (value: string | null) => void;
  onPickLocation: (value: LocationPoint | null) => void;
  onPickLocationLabel: (value: string) => void;
  onSubmit: () => void;
  onClearDraft: () => void;
  onOpenDuplicate: (id: number) => void;
}) {
  const [formMessage, setFormMessage] = useState('');
  const [ignoreDuplicateId, setIgnoreDuplicateId] = useState<number | null>(null);
  const [mapPickerOpen, setMapPickerOpen] = useState(Boolean(pickedLocation));
  const categoryMeta = categories.find((item) => item.label === selectedCategory) ?? categories[0];
  const isPhotoReady = Boolean(pickedImage);
  const isDescriptionReady = description.trim().length >= 10;
  const isLocationReady = Boolean(pickedLocation);
  const readiness = (isPhotoReady ? 1 : 0) + 1 + (isDescriptionReady ? 1 : 0) + (isLocationReady ? 1 : 0);
  const canSubmit = readiness === 4;
  const evidenceScore = Math.min(96, 42 + (isPhotoReady ? 26 : 0) + (description.trim().length >= 35 ? 14 : isDescriptionReady ? 8 : 0) + (isLocationReady ? 14 : 0));
  const similarReport = reports.find(
    (report) => report.category === selectedCategory && report.status !== 'Решено' && report.status !== 'Отклонено' && report.id !== ignoreDuplicateId,
  );
  const nextMissing = !isPhotoReady
    ? 'Добавьте фото проблемы'
    : !isDescriptionReady
      ? 'Коротко опишите ситуацию'
      : !isLocationReady
        ? 'Выберите место на карте'
        : 'Можно отправлять';

  const takePhoto = async () => {
    setFormMessage('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setFormMessage('Разрешите доступ к камере.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [4, 3], quality: 0.82, mediaTypes: ['images'] });
    if (!result.canceled && result.assets[0]?.uri) onPickImage(result.assets[0].uri);
  };

  const chooseFromLibrary = async () => {
    setFormMessage('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setFormMessage('Разрешите доступ к фото.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [4, 3], quality: 0.82, mediaTypes: ['images'] });
    if (!result.canceled && result.assets[0]?.uri) onPickImage(result.assets[0].uri);
  };

  const useCurrentLocation = async () => {
    setFormMessage('');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setFormMessage('Разрешите доступ к местоположению.');
      return;
    }

    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const coordinate = { latitude: current.coords.latitude, longitude: current.coords.longitude };
    let readableLabel = 'Мое место на карте';
    try {
      const [place] = await Location.reverseGeocodeAsync(coordinate);
      const parts = [place?.city, place?.district, place?.street || place?.name].filter(Boolean);
      if (parts.length > 0) readableLabel = parts.join(', ');
    } catch {
      readableLabel = 'Мое место на карте';
    }
    onPickLocation(coordinate);
    onPickLocationLabel(readableLabel);
    setFormMessage('Поставили точку на карте. Можно уточнить ее вручную.');
    setMapPickerOpen(true);
  };

  const chooseMapPoint = (point: LocationChoice) => {
    onPickLocation({ latitude: point.latitude, longitude: point.longitude });
    onPickLocationLabel(point.label);
    setMapPickerOpen(true);
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Новая заявка" rightText={`${readiness}/4`} />
      <View style={styles.taskHint}>
        <Text style={styles.taskHintLabel}>Следующий шаг</Text>
        <Text style={styles.taskHintTitle}>{nextMissing}</Text>
        <Text style={styles.taskHintText}>Фото, описание и место на карте помогают проверить обращение без дополнительных вопросов.</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(readiness / 4) * 100}%` }]} />
        </View>
        <View style={styles.taskMetaRow}>
          <MiniBadge icon="leaf" text={`до +${categoryMeta.pointsPreview} листиков`} />
          <MiniBadge icon="shield-check-outline" text={`доказательность ${evidenceScore}%`} />
        </View>
      </View>

      <StepBlock number="1" title="Фото" done={isPhotoReady}>
        <View style={styles.photoBox}>
          <Image source={pickedImage ? { uri: pickedImage } : reportImage} style={styles.photoPreview} />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.58)']} style={styles.photoOverlay}>
            <Text style={styles.photoOverlayText}>{isPhotoReady ? 'Фото добавлено' : 'Лучше снять общий план и крупную деталь'}</Text>
          </LinearGradient>
          <View style={styles.inlineActions}>
            <Pressable style={styles.outlineButton} onPress={takePhoto}>
              <MaterialCommunityIcons name="camera-outline" size={18} color="#141414" />
              <Text style={styles.outlineButtonText}>Камера</Text>
            </Pressable>
            <Pressable style={styles.outlineButton} onPress={chooseFromLibrary}>
              <MaterialCommunityIcons name="image-outline" size={18} color="#141414" />
              <Text style={styles.outlineButtonText}>Галерея</Text>
            </Pressable>
          </View>
        </View>
      </StepBlock>

      <StepBlock number="2" title={`Категория: ${selectedCategory}`} done>
        <Text style={styles.fieldHintTop}>{categoryMeta.evidenceTip}</Text>
        <View style={styles.categoryChips}>
          {categories.map((item) => {
            const active = selectedCategory === item.label;
            return (
              <Pressable key={item.label} style={[styles.chip, active && styles.chipActive]} onPress={() => onSelectCategory(item.label)}>
                <MaterialCommunityIcons name={item.icon} size={16} color={active ? '#ffffff' : '#6b7280'} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </StepBlock>

      {similarReport ? (
        <SimilarReportCard
          report={similarReport}
          onOpen={() => onOpenDuplicate(similarReport.id)}
          onDismiss={() => setIgnoreDuplicateId(similarReport.id)}
        />
      ) : null}

      <StepBlock number="3" title="Описание места" done={isDescriptionReady}>
        <TextInput
          value={description}
          onChangeText={onChangeDescription}
          multiline
          placeholder="Что произошло и как найти место?"
          placeholderTextColor="#8b8b8b"
          style={styles.textArea}
        />
        <Text style={styles.fieldHint}>Например: что видно рядом, есть ли техника, мусор, следы работ или запах.</Text>
        <EvidenceMeter score={evidenceScore} />
      </StepBlock>

      <StepBlock number="4" title="Место на карте" done={isLocationReady}>
        <LocationPicker
          pickedLocation={pickedLocation}
          pickedLocationLabel={pickedLocationLabel}
          mapPickerOpen={mapPickerOpen}
          onUseCurrentLocation={useCurrentLocation}
          onOpenMap={() => {
            setFormMessage('Выберите точку на карте ниже.');
            setMapPickerOpen(true);
          }}
          onChoosePoint={chooseMapPoint}
        />
      </StepBlock>

      {formMessage ? <Text style={styles.inlineHint}>{formMessage}</Text> : null}

      <Pressable style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]} onPress={canSubmit ? onSubmit : undefined}>
        <Text style={styles.primaryButtonText}>{canSubmit ? 'Отправить заявку' : nextMissing}</Text>
      </Pressable>
      <Pressable style={styles.textButton} onPress={onClearDraft}>
        <Text style={styles.textButtonText}>Очистить черновик</Text>
      </Pressable>
    </View>
  );
}

function SuccessScreen({ report, onMessages, onAnother }: { report: Report; onMessages: () => void; onAnother: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.successBlock}>
        <View style={styles.successIcon}>
          <MaterialCommunityIcons name="check" size={34} color="#ffffff" />
        </View>
        <Text style={styles.successTitle}>Заявка принята</Text>
        <Text style={styles.successText}>{report.publicId} отправлена на проверку. После подтверждения можно получить +{report.points} листиков.</Text>
        <View style={styles.successMetaRow}>
          <MiniBadge icon="shield-check-outline" text={`${report.evidenceScore}% доказательность`} />
          <MiniBadge icon="clock-outline" text={report.nextActionLabel} />
        </View>
      </View>

      <View style={styles.listPanel}>
        <InfoRow icon="eye-check-outline" title="1. Проверим заявку" text="Модератор проверит фото, описание и место." />
        <InfoRow icon="send-check-outline" title="2. Передадим ответственным" text="После проверки заявку получит профильная служба." />
        <InfoRow icon="gift-outline" title="3. Дадим листики" text="Листики появятся после подтверждения полезного действия." />
      </View>

      <Pressable style={styles.primaryButton} onPress={onMessages}>
        <Text style={styles.primaryButtonText}>Открыть заявки</Text>
      </Pressable>
      <Pressable style={styles.textButton} onPress={onAnother}>
        <Text style={styles.textButtonText}>Сообщить еще</Text>
      </Pressable>
    </View>
  );
}

function MessagesScreen({
  reports,
  selectedReportId,
  onSelectReport,
  confirmedReportIds,
  onConfirmReport,
}: {
  reports: Report[];
  selectedReportId: number;
  onSelectReport: (id: number) => void;
  confirmedReportIds: Set<string>;
  onConfirmReport: (report: Report) => void;
}) {
  const [filter, setFilter] = useState<ReportFilter>('Все');
  const visibleReports = reports.filter((report) => {
    if (filter === 'Все') return true;
    if (filter === 'Активные') return report.status !== 'Решено' && report.status !== 'Отклонено';
    return report.status === 'Решено';
  });
  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? reports[0];

  return (
    <View style={styles.screen}>
      <AppHeader title="Мои заявки" rightText={`${reports.length}`} />
      <Text style={styles.leadText}>Откройте заявку, чтобы увидеть текущий этап, ответственного и следующий шаг.</Text>
      <SegmentedControl value={filter} onChange={setFilter} />

      <View style={styles.listPanel}>
        {visibleReports.map((report) => (
          <Pressable key={report.id} onPress={() => onSelectReport(report.id)}>
            <ReportRow report={report} selected={selectedReport.id === report.id} />
          </Pressable>
        ))}
      </View>

      <ReportDetail
        report={selectedReport}
        isConfirmed={confirmedReportIds.has(selectedReport.publicId)}
        onConfirmReport={onConfirmReport}
      />
    </View>
  );
}

function MapScreen({
  reports,
  confirmedReportIds,
  onConfirmReport,
}: {
  reports: Report[];
  confirmedReportIds: Set<string>;
  onConfirmReport: (report: Report) => void;
}) {
  const [mapFilter, setMapFilter] = useState('Все');
  const [selectedReportPublicId, setSelectedReportPublicId] = useState(reports[0]?.publicId ?? '');
  const [selectedPointLabel, setSelectedPointLabel] = useState(mapPoints[0].label);
  const filters = ['Все', 'Вырубка', 'Мусор', 'Вода'];
  const filtered = reports.filter((report) => mapFilter === 'Все' || report.category === mapFilter);
  const selectedNativeReport = filtered.find((report) => report.publicId === selectedReportPublicId) ?? filtered[0] ?? reports[0];
  const visiblePoints = mapPoints.filter((point) => filtered.some((report) => report.location === point.label));
  const safePoints = visiblePoints.length > 0 ? visiblePoints : mapPoints;
  const selectedPoint = safePoints.find((point) => point.label === selectedPointLabel) ?? safePoints[0];
  const nearestReport = Platform.OS === 'web'
    ? filtered.find((report) => report.location === selectedPoint.label) ?? filtered[0] ?? reports[0]
    : selectedNativeReport;
  const isConfirmed = confirmedReportIds.has(nearestReport.publicId);
  const palette = getStatusPalette(nearestReport.status);
  const initialRegion = {
    latitude: nearestReport.latitude || 52.28697,
    longitude: nearestReport.longitude || 104.30502,
    latitudeDelta: 2.8,
    longitudeDelta: 4.8,
  };

  const handleFilter = (item: string) => {
    const nextFiltered = reports.filter((report) => item === 'Все' || report.category === item);
    const nextReport = nextFiltered[0] ?? reports[0];
    setMapFilter(item);
    setSelectedReportPublicId(nextReport.publicId);
    setSelectedPointLabel(nextReport.location);
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Карта" rightText={`${filtered.length}`} />
      <Text style={styles.leadText}>Нажмите точку на карте. Если были рядом и видели проблему, подтвердите заявку.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {filters.map((item) => (
          <Pressable key={item} style={[styles.chip, mapFilter === item && styles.chipActive]} onPress={() => handleFilter(item)}>
            <Text style={[styles.chipText, mapFilter === item && styles.chipTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {Platform.OS !== 'web' ? (
        <View style={styles.nativeMapCanvas}>
          <MapView
            style={styles.nativeMap}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={initialRegion}
            showsUserLocation
            showsMyLocationButton
            onPress={() => undefined}
          >
            {filtered.map((report) => {
              const markerPalette = getStatusPalette(report.status);
              return (
                <Marker
                  key={report.publicId}
                  coordinate={{ latitude: report.latitude, longitude: report.longitude }}
                  pinColor={markerPalette.text}
                  onPress={() => setSelectedReportPublicId(report.publicId)}
                >
                  <Callout onPress={() => setSelectedReportPublicId(report.publicId)}>
                    <View style={styles.mapCallout}>
                      <Text style={styles.mapCalloutTitle}>{report.title}</Text>
                      <Text style={styles.mapCalloutText}>{report.publicId} · {report.status}</Text>
                    </View>
                  </Callout>
                </Marker>
              );
            })}
          </MapView>
          <View style={styles.mapSheet}>
            <View style={styles.mapSheetHandle} />
            <View style={styles.mapSheetHeader}>
              <View style={[styles.mapSheetIcon, { backgroundColor: palette.bg }]}>
                <MaterialCommunityIcons name="map-marker-alert-outline" size={21} color={palette.text} />
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.mapSheetMeta}>{nearestReport.publicId} · {nearestReport.location}</Text>
                <Text style={styles.mapSheetTitle}>{nearestReport.title}</Text>
                <Text style={styles.mapSheetText}>{nearestReport.confirmations} подтверждений · {nearestReport.nextActionLabel}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
                <Text style={[styles.statusPillText, { color: palette.text }]}>{nearestReport.status}</Text>
              </View>
            </View>
            <Pressable
              style={[styles.mapConfirmButton, isConfirmed && styles.mapConfirmButtonDone]}
              disabled={isConfirmed || !nearestReport.canConfirm}
              onPress={() => onConfirmReport(nearestReport)}
            >
              <Text style={[styles.mapConfirmButtonText, isConfirmed && styles.mapConfirmButtonTextDone]}>
                {isConfirmed ? 'Спасибо, учли' : nearestReport.canConfirm ? 'Я видел это место' : 'Заявка закрыта'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
      <View style={styles.mapCanvas}>
        <Image source={heroImage} style={styles.mapImage} resizeMode="cover" />
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.72)']} style={styles.mapImageOverlay} />
        <View style={styles.mapTopBar}>
          <View>
            <Text style={styles.mapTitle}>Иркутская область</Text>
            <Text style={styles.mapSubtitle}>{safePoints.length} точки на карте</Text>
          </View>
          <View style={styles.mapLocateButton}>
            <MaterialCommunityIcons name="crosshairs-gps" size={19} color="#141414" />
          </View>
        </View>
        {safePoints.map((point) => {
          const report = filtered.find((item) => item.location === point.label) ?? reports.find((item) => item.location === point.label);
          const pointPalette = getStatusPalette(report?.status ?? 'На модерации');
          const active = point.label === selectedPoint.label;
          return (
            <Pressable
              key={point.label}
              style={[styles.liveMapPin, { top: point.top, left: point.left }, active && styles.liveMapPinActive]}
              onPress={() => setSelectedPointLabel(point.label)}
            >
              <View style={[styles.liveMapPinCore, { backgroundColor: pointPalette.text }, active && styles.liveMapPinCoreActive]} />
            </Pressable>
          );
        })}
        <View style={styles.mapSheet}>
          <View style={styles.mapSheetHandle} />
          <View style={styles.mapSheetHeader}>
            <View style={[styles.mapSheetIcon, { backgroundColor: palette.bg }]}>
              <MaterialCommunityIcons name="map-marker-alert-outline" size={21} color={palette.text} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.mapSheetMeta}>{nearestReport.publicId} · {selectedPoint.label}</Text>
              <Text style={styles.mapSheetTitle}>{nearestReport.title}</Text>
              <Text style={styles.mapSheetText}>{nearestReport.confirmations} подтверждений · {nearestReport.nextActionLabel}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
              <Text style={[styles.statusPillText, { color: palette.text }]}>{nearestReport.status}</Text>
            </View>
          </View>
          <Pressable
            style={[styles.mapConfirmButton, isConfirmed && styles.mapConfirmButtonDone]}
            disabled={isConfirmed || !nearestReport.canConfirm}
            onPress={() => {
              onConfirmReport(nearestReport);
            }}
          >
            <Text style={[styles.mapConfirmButtonText, isConfirmed && styles.mapConfirmButtonTextDone]}>
              {isConfirmed ? 'Спасибо, учли' : nearestReport.canConfirm ? 'Я видел это место' : 'Заявка закрыта'}
            </Text>
          </Pressable>
        </View>
      </View>
      )}
    </View>
  );
}

function ProfileScreen({
  balance,
  reports,
  rewards,
  claimedRewards,
  lastClaim,
  username,
  onClaimReward,
  onLogout,
}: {
  balance: number;
  reports: Report[];
  rewards: Reward[];
  claimedRewards: RewardClaim[];
  lastClaim: RewardClaim | null;
  username: string;
  onClaimReward: (reward: Reward) => void;
  onLogout: () => void;
}) {
  const openUrl = (url: string) => {
    if (!url) return;
    Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Бонусы" rightText={`${balance} листиков`} />
      <RewardsSection balance={balance} rewards={rewards} claimedRewards={claimedRewards} onClaimReward={onClaimReward} />

      {lastClaim ? (
        <View style={styles.claimCodePanel}>
          <Text style={styles.claimCodeLabel}>Последний бонус</Text>
          <Text style={styles.claimCodeValue}>{lastClaim.code}</Text>
          <Text style={styles.claimCodeText}>Покажите код партнеру. История выдачи сохранена на сервере.</Text>
        </View>
      ) : null}

      <View style={styles.profileCard}>
        <Text style={styles.profileInitial}>{username.slice(0, 1).toUpperCase()}</Text>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>@{username}</Text>
          <Text style={styles.rowText}>Заявки, листики и бонусы привязаны к аккаунту</Text>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryCell label="Листики" value={`${balance}`} />
        <SummaryCell label="Заявки" value={`${reports.length}`} />
        <SummaryCell label="Доверие" value="82%" />
      </View>

      <View style={styles.listPanel}>
        <InfoRow icon="shield-check-outline" title="Профиль и доверие" text="Здесь хранятся бонусы, настройки приватности и уровень доверия." />
        <InfoRow icon="bell-outline" title="Уведомления" text="Приложение сообщит, когда у заявки изменится статус." />
        <Pressable onPress={() => openUrl(PRIVACY_URL)} disabled={!PRIVACY_URL}>
          <InfoRow
            icon="file-document-outline"
            title="Политика приватности"
            text={PRIVACY_URL ? 'Откроется в браузере.' : 'Добавим публичную ссылку перед релизом.'}
          />
        </Pressable>
        <Pressable onPress={() => openUrl(TERMS_URL)} disabled={!TERMS_URL}>
          <InfoRow
            icon="clipboard-text-outline"
            title="Пользовательское соглашение"
            text={TERMS_URL ? 'Правила сервиса, баллов и модерации.' : 'Добавим публичную ссылку перед релизом.'}
          />
        </Pressable>
        <Pressable onPress={() => openUrl(SUPPORT_URL)} disabled={!SUPPORT_URL}>
          <InfoRow
            icon="lifebuoy"
            title="Поддержка"
            text={SUPPORT_URL ? 'Связь по вопросам заявок и данных.' : 'Нужна публичная страница поддержки.'}
          />
        </Pressable>
      </View>
      <View style={styles.trustPanel}>
        <Text style={styles.trustTitle}>Как растет доверие</Text>
        <TrustLine icon="camera-outline" title="Фото с места" value="+12%" />
        <TrustLine icon="account-check-outline" title="Подтверждения других людей" value="+18%" />
        <TrustLine icon="check-decagram-outline" title="Решенные заявки" value="+25%" />
      </View>

      <Pressable style={styles.logoutButton} onPress={onLogout}>
        <MaterialCommunityIcons name="logout" size={18} color="#a33a3a" />
        <Text style={styles.logoutButtonText}>Выйти из аккаунта</Text>
      </Pressable>
    </View>
  );
}

function AdminScreen({
  reports,
  users,
  rewards,
  promoCodes,
  syncMessage,
  isSyncing,
  adminReady,
  authMessage,
  onAdminLogin,
  onCreatePromoCode,
  onRefresh,
  onStatusChange,
}: {
  reports: Report[];
  users: AdminUser[];
  rewards: Reward[];
  promoCodes: AdminPromoCode[];
  syncMessage: string;
  isSyncing: boolean;
  adminReady: boolean;
  authMessage: string;
  onAdminLogin: (username: string, password: string) => void;
  onCreatePromoCode: (profileId: string, rewardId: string) => Promise<void>;
  onRefresh: () => void;
  onStatusChange: (report: Report, status: ReportStatusCode) => void;
}) {
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [selectedPromoProfileId, setSelectedPromoProfileId] = useState('');
  const [selectedPromoRewardId, setSelectedPromoRewardId] = useState('');
  const [promoMessage, setPromoMessage] = useState('');
  const activeReports = reports.filter((report) => report.statusCode !== 'resolved' && report.statusCode !== 'rejected');
  const moderationCount = reports.filter((report) => report.statusCode === 'moderation').length;
  const resolvedCount = reports.filter((report) => report.statusCode === 'resolved').length;
  const totalBalance = users.reduce((sum, user) => sum + user.balance, 0);
  const totalSpent = users.reduce((sum, user) => sum + user.spent, 0);
  const promoProfileId = selectedPromoProfileId || users[0]?.profileId || '';
  const promoRewardId = selectedPromoRewardId || rewards[0]?.id || '';

  return (
    <View style={styles.screen}>
      <AppHeader title="Админка" rightText={`${activeReports.length} активных`} />
      <View style={styles.adminNotice}>
        <MaterialCommunityIcons name={adminReady ? 'server-network' : 'shield-alert-outline'} size={20} color="#00736F" />
        <View style={styles.rowCopy}>
          <Text style={styles.adminNoticeTitle}>{isSyncing ? 'Синхронизация...' : adminReady ? 'Контур управления' : 'Войдите в админку'}</Text>
          <Text style={styles.adminNoticeText}>{adminReady ? syncMessage : 'После входа появятся пользователи, заявки и управление статусами.'}</Text>
        </View>
        <Pressable style={styles.adminRefreshButton} onPress={onRefresh}>
          <MaterialCommunityIcons name="refresh" size={18} color="#141414" />
        </Pressable>
      </View>

      {!adminReady ? (
        <View style={styles.adminLoginPanel}>
          <Text style={styles.authLabel}>Логин</Text>
          <TextInput
            value={adminUsername}
            onChangeText={setAdminUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="логин администратора"
            placeholderTextColor="#8b8b8b"
            style={styles.authInput}
          />
          <Text style={styles.authLabel}>Пароль</Text>
          <TextInput
            value={adminPassword}
            onChangeText={setAdminPassword}
            secureTextEntry
            placeholder="пароль"
            placeholderTextColor="#8b8b8b"
            style={styles.authInput}
          />
          {authMessage ? <Text style={styles.authError}>{authMessage}</Text> : null}
          <Pressable
            style={[styles.primaryButton, (!adminUsername.trim() || !adminPassword) && styles.primaryButtonDisabled]}
            disabled={!adminUsername.trim() || !adminPassword}
            onPress={() => onAdminLogin(adminUsername.trim().toLowerCase(), adminPassword)}
          >
            <Text style={styles.primaryButtonText}>Войти</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.summaryGrid}>
        <SummaryCell label="Модерация" value={`${moderationCount}`} />
        <SummaryCell label="Активные" value={`${activeReports.length}`} />
        <SummaryCell label="Решено" value={`${resolvedCount}`} />
      </View>

      <SectionHeader title="Пользователи" action={`${users.length}`} />
      <View style={styles.adminUserGrid}>
        {users.length > 0 ? users.slice(0, 6).map((user) => <AdminUserCard key={user.id} user={user} />) : (
          <View style={styles.adminEmptyCard}>
            <MaterialCommunityIcons name="account-search-outline" size={22} color="#6b7280" />
            <Text style={styles.adminEmptyTitle}>{adminReady ? 'Пользователей пока нет' : 'База пользователей закрыта'}</Text>
            <Text style={styles.adminEmptyText}>{adminReady ? 'После регистрации аккаунты появятся здесь.' : 'Войдите, чтобы увидеть аккаунты и балансы.'}</Text>
          </View>
        )}
      </View>

      <View style={styles.summaryGrid}>
        <SummaryCell label="Листики" value={`${totalBalance}`} />
        <SummaryCell label="Списано" value={`${totalSpent}`} />
        <SummaryCell label="Промокоды" value={`${promoCodes.length}`} />
      </View>

      <SectionHeader title="Промокоды" action={`${promoCodes.length}`} />
      <View style={styles.adminPromoPanel}>
        <Text style={styles.adminPickerTitle}>Кому выдать</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.adminChipRow}>
          {users.map((user) => {
            const active = promoProfileId === user.profileId;
            return (
              <Pressable key={user.id} style={[styles.chip, active && styles.chipActive]} onPress={() => setSelectedPromoProfileId(user.profileId)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>@{user.username}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.adminPickerTitle}>Какой бонус</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.adminChipRow}>
          {rewards.map((reward) => {
            const active = promoRewardId === reward.id;
            return (
              <Pressable key={reward.id} style={[styles.chip, active && styles.chipActive]} onPress={() => setSelectedPromoRewardId(reward.id)}>
                <MaterialCommunityIcons name={reward.icon} size={16} color={active ? '#ffffff' : '#6b7280'} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{reward.title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {promoMessage ? <Text style={styles.inlineHint}>{promoMessage}</Text> : null}
        <Pressable
          style={[styles.primaryButton, (!adminReady || !promoProfileId || !promoRewardId) && styles.primaryButtonDisabled]}
          disabled={!adminReady || !promoProfileId || !promoRewardId}
          onPress={() => {
            setPromoMessage('');
            onCreatePromoCode(promoProfileId, promoRewardId)
              .then(() => setPromoMessage('Промокод создан'))
              .catch((error) => setPromoMessage(error instanceof Error ? error.message : 'Не удалось создать промокод'));
          }}
        >
          <Text style={styles.primaryButtonText}>Создать промокод</Text>
        </Pressable>
        <View style={styles.adminPromoList}>
          {promoCodes.slice(0, 4).map((promo) => (
            <View key={promo.id} style={styles.adminPromoRow}>
              <View style={styles.rowCopy}>
                <Text style={styles.adminPromoCode}>{promo.code}</Text>
                <Text style={styles.adminUserMeta}>{promo.rewardTitle} · {promo.profileId}</Text>
              </View>
              <MiniMetric label="списано" value={`${promo.pointsSpent}`} />
            </View>
          ))}
        </View>
      </View>

      <SectionHeader title="База" action="срез" />
      <View style={styles.adminDbPanel}>
        <InfoRow icon="account-group-outline" title="Пользователи" text={`${users.length} аккаунтов в базе`} />
        <InfoRow icon="clipboard-text-outline" title="Обращения" text={`${reports.length} заявок со статусами и координатами`} />
        <InfoRow icon="ticket-percent-outline" title="Промокоды" text={`${promoCodes.length} выданных кодов`} />
      </View>

      <SectionHeader title="Очередь заявок" action={`${reports.length}`} />
      <View style={styles.listPanel}>
        {reports.map((report) => (
          <AdminReportCard key={report.publicId} report={report} adminReady={adminReady} onStatusChange={onStatusChange} />
        ))}
      </View>
    </View>
  );
}

function AdminUserCard({ user }: { user: AdminUser }) {
  return (
    <View style={styles.adminUserCard}>
      <View style={styles.adminUserHeader}>
        <View style={styles.adminUserAvatar}>
          <Text style={styles.adminUserAvatarText}>{user.username.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.adminUserName}>@{user.username}</Text>
          <Text style={styles.adminUserMeta} numberOfLines={1}>{user.profileId}</Text>
        </View>
      </View>
      <View style={styles.adminUserMetrics}>
        <MiniMetric label="листики" value={`${user.balance}`} />
        <MiniMetric label="заявки" value={`${user.reports}`} />
        <MiniMetric label="активно" value={`${user.activeReports}`} />
      </View>
    </View>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.adminMiniMetric}>
      <Text style={styles.adminMiniMetricValue}>{value}</Text>
      <Text style={styles.adminMiniMetricLabel}>{label}</Text>
    </View>
  );
}

function AdminReportCard({
  report,
  adminReady,
  onStatusChange,
}: {
  report: Report;
  adminReady: boolean;
  onStatusChange: (report: Report, status: ReportStatusCode) => void;
}) {
  const actions: Array<{ status: ReportStatusCode; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = [];

  if (report.statusCode === 'moderation') {
    actions.push({ status: 'transferred', label: 'Передать', icon: 'send-check-outline' });
    actions.push({ status: 'rejected', label: 'Отклонить', icon: 'close-circle-outline' });
  }
  if (report.statusCode === 'transferred') {
    actions.push({ status: 'in_progress', label: 'В работу', icon: 'progress-check' });
    actions.push({ status: 'rejected', label: 'Отклонить', icon: 'close-circle-outline' });
  }
  if (report.statusCode === 'in_progress') {
    actions.push({ status: 'resolved', label: 'Решено', icon: 'check-decagram-outline' });
    actions.push({ status: 'transferred', label: 'Вернуть', icon: 'undo-variant' });
  }

  return (
    <View style={styles.adminCard}>
      <View style={styles.adminCardHeader}>
        <View style={styles.rowCopy}>
          <Text style={styles.reportId}>{report.publicId}</Text>
          <Text style={styles.adminCardTitle}>{report.title}</Text>
          <Text style={styles.reportMeta}>{report.location} · {report.category} · {report.date}</Text>
        </View>
        <StatusPill status={report.status} />
      </View>
      <Text style={styles.adminCardText}>{report.nextStep}</Text>
      <View style={styles.adminActions}>
        {actions.length > 0 ? actions.map((action) => (
          <Pressable
            key={action.status}
            style={[styles.adminActionButton, !adminReady && styles.adminActionButtonDisabled]}
            disabled={!adminReady}
            onPress={() => onStatusChange(report, action.status)}
          >
            <MaterialCommunityIcons name={action.icon} size={16} color="#141414" />
            <Text style={styles.adminActionText}>{action.label}</Text>
          </Pressable>
        )) : (
          <Text style={styles.adminDoneText}>Финальный статус, действий нет</Text>
        )}
      </View>
    </View>
  );
}

function BottomNav({ activeTab, onChange }: { activeTab: Tab; onChange: (tab: Tab) => void }) {
  const tabs: Array<{ id: Tab; icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string }> = [
    { id: 'home', icon: 'home-variant-outline', label: 'Главная' },
    { id: 'map', icon: 'map-outline', label: 'Карта' },
    { id: 'report', icon: 'plus-circle', label: 'Сообщить' },
    { id: 'messages', icon: 'clipboard-text-outline', label: 'Заявки' },
    { id: 'profile', icon: 'gift-outline', label: 'Бонусы' },
    ...(ADMIN_ENABLED ? [{ id: 'admin' as Tab, icon: 'shield-crown-outline' as keyof typeof MaterialCommunityIcons.glyphMap, label: 'Админ' }] : []),
  ];

  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id || (activeTab === 'success' && tab.id === 'report');
        return (
          <Pressable key={tab.id} style={[styles.navItem, tab.id === 'report' && styles.navActionItem, noWebOutline]} onPress={() => onChange(tab.id)}>
            {tab.id === 'report' ? (
              <View style={styles.navActionCircle}>
                <MaterialCommunityIcons name="plus" size={24} color="#ffffff" />
              </View>
            ) : (
              <MaterialCommunityIcons name={tab.icon} size={23} color={active ? '#141414' : '#8b8b8b'} />
            )}
            <Text style={[styles.navText, active && styles.navTextActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AppHeader({ title, rightText }: { title: string; rightText?: string }) {
  return (
    <View style={styles.appHeader}>
      <View>
        <Text style={styles.appTitle}>{title}</Text>
        <Text style={styles.appSubtitle}>Байкал в наших руках</Text>
      </View>
      {rightText ? (
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>{rightText}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Pressable onPress={onAction}>
        <Text style={styles.sectionAction}>{action}</Text>
      </Pressable>
    </View>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function MiniBadge({ icon, text }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; text: string }) {
  return (
    <View style={styles.miniBadge}>
      <MaterialCommunityIcons name={icon} size={14} color="#00736F" />
      <Text style={styles.miniBadgeText}>{text}</Text>
    </View>
  );
}

function RewardsSection({
  balance,
  rewards,
  claimedRewards,
  onClaimReward,
  compact = false,
}: {
  balance: number;
  rewards: Reward[];
  claimedRewards: RewardClaim[];
  onClaimReward: (reward: Reward) => void;
  compact?: boolean;
}) {
  const nextReward = rewards.find((reward) => reward.cost > balance);
  const targetCost = nextReward?.cost ?? rewards[rewards.length - 1]?.cost ?? Math.max(balance, 1);
  const progress = Math.min(100, Math.round((balance / targetCost) * 100));
  const availableCount = rewards.filter((reward) => balance >= reward.cost).length;
  const claimedIds = new Set(claimedRewards.map((claim) => claim.rewardId));

  return (
    <View style={styles.rewardsPanel}>
      <View style={styles.rewardsHeader}>
        <View>
          <Text style={styles.rewardsTitle}>Бонусы за помощь</Text>
          <Text style={styles.rewardsText}>Листики можно обменять у партнеров Байкала.</Text>
        </View>
        <View style={styles.leafBalance}>
          <MaterialCommunityIcons name="leaf" size={18} color="#ffffff" />
          <Text style={styles.leafBalanceText}>{balance}</Text>
        </View>
      </View>
      <View style={styles.rewardProgress}>
        <View style={styles.rewardProgressTop}>
          <Text style={styles.rewardProgressText}>{nextReward ? 'Следующий бонус' : 'Все бонусы доступны'}</Text>
          <Text style={styles.rewardProgressValue}>{nextReward ? `${nextReward.cost - balance} еще` : `${availableCount}/${rewards.length}`}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      </View>
      <View style={styles.rewardList}>
        {(compact ? rewards.slice(0, 2) : rewards).map((reward) => (
          <RewardCard
            key={reward.id}
            reward={reward}
            available={balance >= reward.cost}
            claimed={claimedIds.has(reward.id)}
            onClaim={() => onClaimReward(reward)}
          />
        ))}
      </View>
    </View>
  );
}

function RewardCard({
  reward,
  available,
  claimed,
  onClaim,
}: {
  reward: Reward;
  available: boolean;
  claimed: boolean;
  onClaim: () => void;
}) {
  return (
    <View style={[styles.rewardCard, !available && styles.rewardCardLocked]}>
      <View style={styles.rewardIcon}>
        <MaterialCommunityIcons name={claimed ? 'check' : reward.icon} size={22} color={available || claimed ? '#ffffff' : '#6b7280'} />
      </View>
      <View style={styles.rewardCopy}>
        <Text style={styles.rewardPartner}>{reward.partner}</Text>
        <Text style={styles.rewardTitle}>{reward.title}</Text>
        <Text style={styles.rewardBenefit}>{reward.benefit} · {reward.note}</Text>
      </View>
      <Pressable
        style={[styles.rewardCost, (available || claimed) && styles.rewardCostAvailable]}
        disabled={!available || claimed}
        onPress={onClaim}
      >
        <Text style={[styles.rewardCostText, (available || claimed) && styles.rewardCostTextAvailable]}>
          {claimed ? 'Выдан' : available ? 'Забрать' : `${reward.cost}`}
        </Text>
      </Pressable>
    </View>
  );
}

function EvidenceMeter({ score }: { score: number }) {
  const label = score >= 82 ? 'Сильная заявка' : score >= 68 ? 'Почти готово' : 'Добавьте деталей';

  return (
    <View style={styles.evidenceBox}>
      <View style={styles.evidenceHeader}>
        <Text style={styles.evidenceTitle}>{label}</Text>
        <Text style={styles.evidenceValue}>{score}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${score}%` }]} />
      </View>
    </View>
  );
}

function SimilarReportCard({ report, onOpen, onDismiss }: { report: Report; onOpen: () => void; onDismiss: () => void }) {
  return (
    <View style={styles.similarCard}>
      <View style={styles.similarIcon}>
        <MaterialCommunityIcons name="map-marker-question-outline" size={22} color="#ffffff" />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.similarTitle}>Похоже, такая заявка уже есть</Text>
        <Text style={styles.similarText}>{report.title} · {report.location}. Лучше подтвердить ее, если это то же место.</Text>
        <View style={styles.similarActions}>
          <Pressable style={styles.similarButton} onPress={onOpen}>
            <Text style={styles.similarButtonText}>Открыть</Text>
          </Pressable>
          <Pressable style={styles.similarGhostButton} onPress={onDismiss}>
            <Text style={styles.similarGhostText}>Продолжить новую</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function LocationPicker({
  pickedLocation,
  pickedLocationLabel,
  mapPickerOpen,
  onUseCurrentLocation,
  onOpenMap,
  onChoosePoint,
}: {
  pickedLocation: LocationPoint | null;
  pickedLocationLabel: string;
  mapPickerOpen: boolean;
  onUseCurrentLocation: () => void;
  onOpenMap: () => void;
  onChoosePoint: (point: LocationChoice) => void;
}) {
  const activePoint = mapPoints.find(
    (point) => point.latitude === pickedLocation?.latitude && point.longitude === pickedLocation?.longitude,
  );
  const selectedCoordinate = pickedLocation ?? mapPoints[0];
  const handleNativeMapPress = (event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    onChoosePoint({
      latitude,
      longitude,
      label: 'Выбранная точка',
      area: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    });
  };

  return (
    <View style={styles.locationPicker}>
      <View style={styles.locationActions}>
        <Pressable style={styles.locationAction} onPress={onUseCurrentLocation}>
          <MaterialCommunityIcons name="crosshairs-gps" size={18} color="#141414" />
          <Text style={styles.locationActionText}>Мое место</Text>
        </Pressable>
        <Pressable style={styles.locationAction} onPress={onOpenMap}>
          <MaterialCommunityIcons name="map-search-outline" size={18} color="#141414" />
          <Text style={styles.locationActionText}>Выбрать на карте</Text>
        </Pressable>
      </View>

      {mapPickerOpen ? (
        <View style={styles.locationMap}>
          {Platform.OS !== 'web' ? (
            <MapView
              style={styles.locationNativeMap}
              provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
              initialRegion={{
                latitude: selectedCoordinate.latitude,
                longitude: selectedCoordinate.longitude,
                latitudeDelta: 0.18,
                longitudeDelta: 0.18,
              }}
              showsUserLocation
              showsMyLocationButton
              onPress={handleNativeMapPress}
            >
              <Marker coordinate={selectedCoordinate} pinColor="#008F9A" />
              {mapPoints.map((point) => (
                <Marker
                  key={point.label}
                  coordinate={{ latitude: point.latitude, longitude: point.longitude }}
                  pinColor={activePoint?.label === point.label ? '#008F9A' : '#247647'}
                  onPress={() => onChoosePoint(point)}
                />
              ))}
            </MapView>
          ) : (
            <>
              <Image source={heroImage} style={styles.locationMapImage} resizeMode="cover" />
              <LinearGradient colors={['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.54)']} style={styles.locationMapOverlay} />
              {mapPoints.map((point) => {
                const active = activePoint?.label === point.label;
                return (
                  <Pressable
                    key={point.label}
                    style={[styles.locationMapPin, { top: point.top, left: point.left }, active && styles.locationMapPinActive]}
                    onPress={() => onChoosePoint(point)}
                  >
                    <View style={[styles.locationMapPinCore, active && styles.locationMapPinCoreActive]} />
                  </Pressable>
                );
              })}
            </>
          )}
          <View style={styles.locationMapCopy}>
            <Text style={styles.locationMapTitle}>{pickedLocationLabel || 'Выберите точку'}</Text>
            <Text style={styles.locationMapText}>
              {pickedLocation ? `${pickedLocation.latitude.toFixed(5)}, ${pickedLocation.longitude.toFixed(5)}` : 'Нажмите на точку на карте или используйте текущее место'}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.locationPointList}>
        {mapPoints.map((point) => {
          const active = activePoint?.label === point.label;
          return (
            <Pressable key={point.label} style={[styles.locationPoint, active && styles.locationPointActive]} onPress={() => onChoosePoint(point)}>
              <Text style={[styles.locationPointTitle, active && styles.locationPointTitleActive]}>{point.label}</Text>
              <Text style={[styles.locationPointText, active && styles.locationPointTextActive]}>{point.area}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function WorkflowStrip() {
  return (
    <View style={styles.workflowStrip}>
      <WorkflowStep icon="camera-outline" title="Фото" text="Снимите проблему" />
      <WorkflowStep icon="map-marker-outline" title="Место" text="Добавьте точку" />
      <WorkflowStep icon="progress-check" title="Статус" text="Следите в заявках" />
    </View>
  );
}

function EmergencyNotice() {
  return (
    <View style={styles.emergencyNotice}>
      <MaterialCommunityIcons name="alert-outline" size={18} color="#00736F" />
      <Text style={styles.emergencyText}>Если есть срочная опасность для людей, сначала звоните в экстренные службы.</Text>
    </View>
  );
}

function WorkflowStep({ icon, title, text }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; text: string }) {
  return (
    <View style={styles.workflowStep}>
      <View style={styles.workflowIcon}>
        <MaterialCommunityIcons name={icon} size={18} color="#ffffff" />
      </View>
      <Text style={styles.workflowTitle}>{title}</Text>
      <Text style={styles.workflowText}>{text}</Text>
    </View>
  );
}

function InfoRow({ icon, title, text }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; text: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons name={icon} size={21} color="#141414" />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowText}>{text}</Text>
      </View>
    </View>
  );
}

function StepBlock({ number, title, done, children }: { number: string; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.stepBlock}>
      <View style={styles.stepHeader}>
        <View style={[styles.stepNumber, done && styles.stepNumberDone]}>
          <Text style={[styles.stepNumberText, done && styles.stepNumberTextDone]}>{done ? '✓' : number}</Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function SegmentedControl({ value, onChange }: { value: ReportFilter; onChange: (filter: ReportFilter) => void }) {
  const options: ReportFilter[] = ['Все', 'Активные', 'Решенные'];
  return (
    <View style={styles.segmented}>
      {options.map((item) => (
        <Pressable key={item} style={[styles.segment, value === item && styles.segmentActive]} onPress={() => onChange(item)}>
          <Text style={[styles.segmentText, value === item && styles.segmentTextActive]}>{item}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ReportRow({ report, selected }: { report: Report; selected?: boolean }) {
  return (
    <View style={[styles.reportRow, selected && styles.reportRowSelected]}>
      <Image source={report.image} style={styles.reportThumb} />
      <View style={styles.reportCopy}>
        <View style={styles.reportTopLine}>
          <Text style={styles.reportId}>{report.publicId}</Text>
          <StatusPill status={report.status} />
        </View>
        <Text style={styles.reportTitle} numberOfLines={1}>{report.title}</Text>
        <Text style={styles.reportMeta} numberOfLines={1}>{report.location} · {report.date}</Text>
      </View>
    </View>
  );
}

function ReportDetail({
  report,
  isConfirmed,
  onConfirmReport,
}: {
  report: Report;
  isConfirmed: boolean;
  onConfirmReport: (report: Report) => void;
}) {
  return (
    <View style={styles.detailPanel}>
      <View style={styles.detailHero}>
        <Image source={report.image} style={styles.detailHeroImage} resizeMode="cover" />
        <LinearGradient colors={['rgba(0,0,0,0.02)', 'rgba(0,58,66,0.78)']} style={styles.detailHeroOverlay} />
        <View style={styles.detailHeroCopy}>
          <StatusPill status={report.status} />
          <Text style={styles.detailHeroKicker}>{report.publicId} · {report.location}</Text>
          <Text style={styles.detailHeroTitle}>{report.title}</Text>
          <Text style={styles.detailHeroText}>{report.nextStep}</Text>
        </View>
      </View>
      <View style={styles.detailMetaGrid}>
        <DetailStat label="Ответственный" value={report.authorityLabel} />
        <DetailStat label="Следующий шаг" value={report.nextActionLabel} />
        <DetailStat label="Доказательность" value={`${report.evidenceScore}%`} />
      </View>
      <View style={styles.timeline}>
        {report.timeline.map((step) => (
          <View style={styles.timelineStep} key={step.label}>
            <View style={[styles.timelineDot, step.done && styles.timelineDotDone]} />
            <Text style={[styles.timelineText, step.done && styles.timelineTextDone]}>{step.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.detailActions}>
        {report.canConfirm ? (
          <Pressable
            style={[styles.detailActionButton, isConfirmed && styles.detailActionButtonDone]}
            disabled={isConfirmed}
            onPress={() => onConfirmReport(report)}
          >
            <MaterialCommunityIcons name="check-circle-outline" size={17} color="#141414" />
            <Text style={styles.detailActionText}>{isConfirmed ? 'Подтверждено' : 'Подтвердить'}</Text>
          </Pressable>
        ) : null}
        {report.canDisputeResolution ? (
          <Pressable style={styles.detailActionButton}>
            <MaterialCommunityIcons name="alert-circle-outline" size={17} color="#141414" />
            <Text style={styles.detailActionText}>Не решено</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailStat}>
      <Text style={styles.detailStatLabel}>{label}</Text>
      <Text style={styles.detailStatValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: ReportStatus }) {
  const palette = getStatusPalette(status);
  return (
    <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
      <MaterialCommunityIcons name={getStatusIcon(status)} size={13} color={palette.text} />
      <Text style={[styles.statusText, { color: palette.text }]}>{status}</Text>
    </View>
  );
}

function TrustLine({ icon, title, value }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; value: string }) {
  return (
    <View style={styles.trustLine}>
      <View style={styles.trustLineIcon}>
        <MaterialCommunityIcons name={icon} size={18} color="#00736F" />
      </View>
      <Text style={styles.trustLineTitle}>{title}</Text>
      <Text style={styles.trustLineValue}>{value}</Text>
    </View>
  );
}

function getStatusPalette(status: ReportStatus) {
  if (status === 'Решено') return { bg: '#e7f6ed', text: '#247647' };
  if (status === 'Отклонено') return { bg: '#f1f3f4', text: '#5f6368' };
  if (status === 'Требует уточнения') return { bg: '#E8F5F3', text: '#00736F' };
  if (status === 'На модерации') return { bg: '#eeeeee', text: '#5f6368' };
  if (status === 'Передано') return { bg: '#E4F6F4', text: '#00736F' };
  return { bg: '#e5f4ff', text: '#1769aa' };
}

function getStatusIcon(status: ReportStatus): keyof typeof MaterialCommunityIcons.glyphMap {
  if (status === 'Решено') return 'check-decagram-outline';
  if (status === 'Отклонено') return 'close-circle-outline';
  if (status === 'Передано') return 'send-check-outline';
  if (status === 'В работе') return 'progress-check';
  if (status === 'Требует уточнения') return 'message-alert-outline';
  return 'clock-check-outline';
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#ffffff',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingBottom: 18,
  },
  screen: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  authShell: {
    flex: 1,
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
  },
  authScrollInner: {
    flexGrow: 1,
    paddingBottom: 18,
  },
  authScreen: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  onboardingTop: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  onboardingBrand: {
    color: '#141414',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
    letterSpacing: 0,
  },
  onboardingSkip: {
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: '#f2f3f5',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingSkipText: {
    color: '#141414',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  onboardingCard: {
    minHeight: 510,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#0A3D44',
    position: 'relative',
  },
  onboardingImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  onboardingImageContent: {
    flex: 1,
    minHeight: 510,
    padding: 22,
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  onboardingIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  onboardingTitle: {
    color: '#ffffff',
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: 0,
  },
  onboardingText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    marginTop: 9,
  },
  onboardingDots: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 9,
  },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#d9dddf',
  },
  onboardingDotActive: {
    width: 26,
    backgroundColor: '#008F9A',
  },
  onboardingActions: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  onboardingSecondaryButton: {
    minHeight: 50,
    minWidth: 96,
    borderRadius: 16,
    backgroundColor: '#f2f3f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingSecondaryText: {
    color: '#141414',
    fontSize: 15,
    fontWeight: '800',
  },
  onboardingSecondaryTextDisabled: {
    color: '#b5bbc0',
  },
  onboardingPrimaryButton: {
    flex: 1,
    paddingHorizontal: 16,
  },
  onboardingLoginLine: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  onboardingLoginText: {
    color: '#008F9A',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  authHero: {
    minHeight: 292,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#0A3D44',
    position: 'relative',
  },
  authHeroImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  authHeroOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  authHeroContent: {
    flex: 1,
    minHeight: 292,
    padding: 18,
    justifyContent: 'flex-end',
  },
  authCompactHero: {
    minHeight: 224,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0A3D44',
    position: 'relative',
  },
  authCompactHeroContent: {
    flex: 1,
    minHeight: 224,
    padding: 18,
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  authPanel: {
    borderRadius: 22,
    backgroundColor: '#f5f6f7',
    padding: 14,
    marginTop: 12,
  },
  authModeRow: {
    minHeight: 44,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 4,
    flexDirection: 'row',
    gap: 4,
    marginBottom: 14,
  },
  authModeButton: {
    flex: 1,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authModeButtonActive: {
    backgroundColor: '#008F9A',
  },
  authModeText: {
    color: '#5f6368',
    fontSize: 14,
    fontWeight: '800',
  },
  authModeTextActive: {
    color: '#ffffff',
  },
  authTitle: {
    color: '#ffffff',
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: 0,
  },
  authText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  authLabel: {
    color: '#141414',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    marginBottom: 7,
  },
  authInput: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    color: '#141414',
    fontSize: 15,
    paddingHorizontal: 13,
    marginBottom: 8,
  },
  authFieldHint: {
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 15,
    marginTop: -2,
    marginBottom: 12,
  },
  authError: {
    color: '#a33a3a',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    marginBottom: 10,
  },
  authBenefitList: {
    marginTop: 12,
  },
  appHeader: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  appTitle: {
    color: '#141414',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: 0,
  },
  appSubtitle: {
    color: '#8b8b8b',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    fontWeight: '600',
  },
  headerBadge: {
    minHeight: 32,
    borderRadius: 16,
    backgroundColor: '#f2f3f5',
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadgeText: {
    color: '#141414',
    fontSize: 12,
    fontWeight: '800',
  },
  heroBlock: {
    minHeight: 268,
    borderRadius: 24,
    backgroundColor: '#0A3D44',
    marginBottom: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 0,
  },
  heroOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
  },
  heroContent: {
    flex: 1,
    minHeight: 268,
    padding: 16,
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  heroPill: {
    alignSelf: 'flex-start',
    minHeight: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  heroPillText: {
    color: '#ffffff',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: 0,
  },
  heroText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 7,
    marginBottom: 12,
  },
  heroButton: {
    minHeight: 50,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
  },
  heroButtonText: {
    color: '#141414',
    fontSize: 15,
    fontWeight: '800',
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: '#008F9A',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  primaryButtonDisabled: {
    backgroundColor: '#e8eaed',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  workflowStrip: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 12,
  },
  workflowStep: {
    flex: 1,
    minHeight: 78,
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 10,
    justifyContent: 'space-between',
  },
  workflowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#008F9A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workflowTitle: {
    color: '#141414',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
  },
  workflowText: {
    color: '#6b7280',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
  },
  emergencyNotice: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#E8F5F3',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 12,
  },
  emergencyText: {
    flex: 1,
    color: '#00736F',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  rewardsPanel: {
    borderRadius: 22,
    backgroundColor: '#f5f6f7',
    padding: 14,
    marginBottom: 14,
  },
  rewardsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  rewardsTitle: {
    color: '#141414',
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
  },
  rewardsText: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    maxWidth: 235,
  },
  leafBalance: {
    minHeight: 42,
    borderRadius: 21,
    backgroundColor: '#008F9A',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  leafBalanceText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  rewardProgress: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 12,
    marginTop: 12,
  },
  rewardProgressTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 9,
  },
  rewardProgressText: {
    color: '#5f6368',
    fontSize: 12,
    fontWeight: '800',
  },
  rewardProgressValue: {
    color: '#00736F',
    fontSize: 12,
    fontWeight: '800',
  },
  rewardList: {
    gap: 8,
    marginTop: 12,
  },
  rewardCard: {
    minHeight: 76,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef0f2',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  rewardCardLocked: {
    opacity: 0.72,
  },
  rewardIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#008F9A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardCopy: {
    flex: 1,
    minWidth: 0,
  },
  rewardPartner: {
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  rewardTitle: {
    color: '#141414',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  rewardBenefit: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    fontWeight: '700',
  },
  rewardCost: {
    minWidth: 72,
    minHeight: 34,
    borderRadius: 17,
    backgroundColor: '#f2f3f5',
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardCostAvailable: {
    backgroundColor: '#E8F5F3',
  },
  rewardCostText: {
    color: '#5f6368',
    fontSize: 12,
    fontWeight: '800',
  },
  rewardCostTextAvailable: {
    color: '#00736F',
  },
  outlineButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  outlineWideButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineWideButtonActive: {
    backgroundColor: '#008F9A',
    borderColor: '#008F9A',
  },
  outlineButtonText: {
    color: '#141414',
    fontSize: 14,
    fontWeight: '800',
  },
  outlineButtonTextActive: {
    color: '#ffffff',
  },
  textButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButtonText: {
    color: '#5f6368',
    fontSize: 14,
    fontWeight: '800',
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 16,
  },
  summaryCell: {
    flex: 1,
    minHeight: 72,
    borderRadius: 17,
    backgroundColor: '#f5f6f7',
    padding: 11,
    justifyContent: 'space-between',
  },
  summaryValue: {
    color: '#141414',
    fontSize: 22,
    lineHeight: 25,
    fontWeight: '800',
  },
  summaryLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
  miniBadge: {
    minHeight: 28,
    borderRadius: 14,
    backgroundColor: '#E8F5F3',
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  miniBadgeText: {
    color: '#00736F',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  sectionHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#141414',
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
  },
  sectionAction: {
    color: '#5f6368',
    fontSize: 13,
    fontWeight: '800',
  },
  listPanel: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 6,
    marginBottom: 14,
  },
  categoryList: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 6,
  },
  infoRow: {
    minHeight: 60,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#f2f3f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
  },
  rowTitle: {
    color: '#141414',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  rowText: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  leadText: {
    color: '#5f6368',
    fontSize: 14,
    lineHeight: 20,
    marginTop: -10,
    marginBottom: 12,
  },
  taskHint: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 14,
    marginTop: -4,
    marginBottom: 12,
  },
  taskHintLabel: {
    color: '#8b8b8b',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  taskHintTitle: {
    color: '#141414',
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
  },
  taskHintText: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  taskMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 10,
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#e1e5e8',
    overflow: 'hidden',
    marginTop: 12,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#008F9A',
  },
  stepBlock: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 12,
    marginBottom: 10,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberDone: {
    backgroundColor: '#008F9A',
  },
  stepNumberText: {
    color: '#141414',
    fontSize: 13,
    fontWeight: '800',
  },
  stepNumberTextDone: {
    color: '#ffffff',
  },
  stepTitle: {
    color: '#141414',
    fontSize: 16,
    fontWeight: '800',
  },
  fieldHintTop: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 17,
    marginTop: -2,
    marginBottom: 10,
  },
  photoBox: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    position: 'relative',
  },
  photoPreview: {
    width: '100%',
    height: 136,
    backgroundColor: '#e8eaed',
  },
  photoOverlay: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    height: 64,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  photoOverlayText: {
    color: '#ffffff',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  inlineActions: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  categoryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterRow: {
    gap: 8,
    paddingBottom: 14,
  },
  chip: {
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipActive: {
    backgroundColor: '#008F9A',
    borderColor: '#008F9A',
  },
  chipText: {
    color: '#5f6368',
    fontSize: 12,
    fontWeight: '800',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  textArea: {
    minHeight: 104,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    color: '#141414',
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
    textAlignVertical: 'top',
  },
  fieldHint: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  evidenceBox: {
    borderRadius: 14,
    backgroundColor: '#ffffff',
    padding: 12,
    marginTop: 10,
  },
  evidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  evidenceTitle: {
    color: '#141414',
    fontSize: 13,
    fontWeight: '800',
  },
  evidenceValue: {
    color: '#00736F',
    fontSize: 13,
    fontWeight: '800',
  },
  locationPicker: {
    gap: 10,
  },
  locationActions: {
    flexDirection: 'row',
    gap: 8,
  },
  locationAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  locationActionText: {
    color: '#141414',
    fontSize: 13,
    fontWeight: '800',
  },
  locationMap: {
    height: 230,
    borderRadius: 18,
    backgroundColor: '#eef3f7',
    overflow: 'hidden',
    position: 'relative',
  },
  locationNativeMap: {
    width: '100%',
    height: '100%',
  },
  locationMapImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  locationMapOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  locationMapPin: {
    position: 'absolute',
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  locationMapPinActive: {
    backgroundColor: '#008F9A',
    transform: [{ scale: 1.12 }],
  },
  locationMapPinCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#008F9A',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  locationMapPinCoreActive: {
    backgroundColor: '#ffffff',
    borderColor: '#008F9A',
  },
  locationMapCopy: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.86)',
    padding: 12,
  },
  locationMapTitle: {
    color: '#141414',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  locationMapText: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },
  locationPointList: {
    gap: 7,
  },
  locationPoint: {
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  locationPointActive: {
    backgroundColor: '#008F9A',
    borderColor: '#008F9A',
  },
  locationPointTitle: {
    color: '#141414',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  locationPointTitleActive: {
    color: '#ffffff',
  },
  locationPointText: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
  locationPointTextActive: {
    color: 'rgba(255,255,255,0.82)',
  },
  mapCanvas: {
    minHeight: 430,
    borderRadius: 22,
    backgroundColor: '#e8f5f3',
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 14,
  },
  nativeMapCanvas: {
    height: 500,
    borderRadius: 22,
    backgroundColor: '#e8f5f3',
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 14,
  },
  nativeMap: {
    width: '100%',
    height: '100%',
  },
  mapCallout: {
    minWidth: 180,
    maxWidth: 230,
    padding: 4,
  },
  mapCalloutTitle: {
    color: '#141414',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  mapCalloutText: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
    fontWeight: '700',
  },
  mapTopBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapSubtitle: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
    fontWeight: '700',
  },
  mapLocateButton: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: '#f5f6f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveMapPin: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveMapPinActive: {
    backgroundColor: '#ffffff',
    transform: [{ scale: 1.18 }],
  },
  liveMapPinCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  liveMapPinCoreActive: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderColor: '#141414',
  },
  mapSheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.93)',
    padding: 12,
  },
  mapSheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    marginBottom: 10,
  },
  mapSheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  mapSheetIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapSheetMeta: {
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  mapSheetTitle: {
    color: '#141414',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  mapSheetText: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  statusPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  mapConfirmButton: {
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: '#008F9A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  mapConfirmButtonDone: {
    backgroundColor: '#e7f6ed',
  },
  mapConfirmButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  mapConfirmButtonTextDone: {
    color: '#247647',
  },
  inlineHint: {
    color: '#00736F',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  similarCard: {
    borderRadius: 18,
    backgroundColor: '#E8F5F3',
    padding: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  similarIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#008F9A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  similarTitle: {
    color: '#141414',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  similarText: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  similarActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 9,
  },
  similarButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  similarButtonText: {
    color: '#141414',
    fontSize: 12,
    fontWeight: '800',
  },
  similarGhostButton: {
    minHeight: 34,
    borderRadius: 17,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  similarGhostText: {
    color: '#00736F',
    fontSize: 12,
    fontWeight: '800',
  },
  adminNotice: {
    minHeight: 66,
    borderRadius: 18,
    backgroundColor: '#E8F5F3',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  adminNoticeTitle: {
    color: '#141414',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  adminNoticeText: {
    color: '#00736F',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    fontWeight: '700',
  },
  adminLoginPanel: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 14,
    marginBottom: 12,
  },
  adminRefreshButton: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminCard: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 12,
    marginBottom: 6,
  },
  adminCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  adminCardTitle: {
    color: '#141414',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
    marginTop: 2,
  },
  adminCardText: {
    color: '#5f6368',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  adminActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  adminUserGrid: {
    gap: 8,
    marginBottom: 12,
  },
  adminUserCard: {
    borderRadius: 16,
    backgroundColor: '#f5f6f7',
    padding: 12,
  },
  adminUserHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  adminUserAvatar: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: '#008F9A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminUserAvatarText: {
    color: '#ffffff',
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '800',
  },
  adminUserName: {
    color: '#141414',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  adminUserMeta: {
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    fontWeight: '700',
  },
  adminUserMetrics: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
  },
  adminMiniMetric: {
    flex: 1,
    minHeight: 52,
    borderRadius: 13,
    backgroundColor: '#ffffff',
    padding: 9,
    justifyContent: 'space-between',
  },
  adminMiniMetricValue: {
    color: '#141414',
    fontSize: 18,
    lineHeight: 21,
    fontWeight: '800',
  },
  adminMiniMetricLabel: {
    color: '#6b7280',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
  adminEmptyCard: {
    minHeight: 112,
    borderRadius: 16,
    backgroundColor: '#f5f6f7',
    padding: 14,
    justifyContent: 'center',
    gap: 5,
  },
  adminEmptyTitle: {
    color: '#141414',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  adminEmptyText: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  adminPromoPanel: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 12,
    marginBottom: 12,
  },
  adminPickerTitle: {
    color: '#141414',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    marginBottom: 8,
  },
  adminChipRow: {
    gap: 8,
    paddingBottom: 12,
  },
  adminPromoList: {
    gap: 7,
    marginTop: 10,
  },
  adminPromoRow: {
    minHeight: 64,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  adminPromoCode: {
    color: '#141414',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: 0,
  },
  adminDbPanel: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 6,
    marginBottom: 12,
  },
  adminActionButton: {
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  adminActionButtonDisabled: {
    opacity: 0.48,
  },
  adminActionText: {
    color: '#141414',
    fontSize: 12,
    fontWeight: '800',
  },
  adminDoneText: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  successBlock: {
    borderRadius: 22,
    backgroundColor: '#f5f6f7',
    padding: 18,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  successIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#008F9A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: {
    color: '#141414',
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    textAlign: 'center',
  },
  successText: {
    color: '#5f6368',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
  },
  successMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
    marginTop: 14,
  },
  segmented: {
    minHeight: 46,
    borderRadius: 18,
    backgroundColor: '#f2f3f5',
    padding: 4,
    flexDirection: 'row',
    marginBottom: 14,
  },
  segment: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: '#ffffff',
  },
  segmentText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: '#141414',
  },
  reportRow: {
    minHeight: 72,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginBottom: 6,
  },
  reportRowSelected: {
    borderWidth: 2,
    borderColor: '#008F9A',
    padding: 8,
  },
  reportThumb: {
    width: 50,
    height: 50,
    borderRadius: 13,
    backgroundColor: '#e8eaed',
  },
  reportCopy: {
    flex: 1,
    minWidth: 0,
  },
  reportTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  reportId: {
    color: '#8b8b8b',
    fontSize: 11,
    fontWeight: '800',
  },
  reportTitle: {
    color: '#141414',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    marginTop: 3,
  },
  reportMeta: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  statusPill: {
    minHeight: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  detailPanel: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 8,
  },
  detailHero: {
    minHeight: 196,
    borderRadius: 17,
    backgroundColor: '#0A3D44',
    overflow: 'hidden',
    position: 'relative',
  },
  detailHeroImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  detailHeroOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  detailHeroCopy: {
    flex: 1,
    padding: 14,
    justifyContent: 'flex-end',
  },
  detailHeroStatus: {
    alignSelf: 'flex-start',
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
    justifyContent: 'center',
    marginBottom: 8,
  },
  detailHeroStatusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  detailHeroKicker: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  detailHeroTitle: {
    color: '#ffffff',
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
  },
  detailHeroText: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  detailMetaGrid: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 8,
  },
  detailStat: {
    flex: 1,
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    padding: 10,
    justifyContent: 'space-between',
  },
  detailStatLabel: {
    color: '#8b8b8b',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
  detailStatValue: {
    color: '#141414',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    marginTop: 5,
  },
  timeline: {
    marginTop: 14,
    paddingHorizontal: 8,
    gap: 10,
  },
  timelineStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#c7cbd1',
  },
  timelineDotDone: {
    backgroundColor: '#008F9A',
  },
  timelineText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
  },
  timelineTextDone: {
    color: '#141414',
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 15,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  detailActionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailActionButtonDone: {
    backgroundColor: '#E8F5F3',
  },
  detailActionText: {
    color: '#141414',
    fontSize: 13,
    fontWeight: '800',
  },
  mapImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  mapImageOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  mapTitle: {
    color: '#141414',
    fontSize: 18,
    fontWeight: '800',
  },
  profileCard: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  profileInitial: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#008F9A',
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 54,
    fontSize: 22,
    fontWeight: '800',
  },
  claimCodePanel: {
    borderRadius: 18,
    backgroundColor: '#0A3D44',
    padding: 16,
    marginBottom: 12,
  },
  claimCodeLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  claimCodeValue: {
    color: '#ffffff',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    marginTop: 4,
    letterSpacing: 0,
  },
  claimCodeText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    fontWeight: '700',
  },
  trustPanel: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 14,
  },
  logoutButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#fff1f1',
    borderWidth: 1,
    borderColor: '#f4c7c7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 2,
  },
  logoutButtonText: {
    color: '#a33a3a',
    fontSize: 14,
    fontWeight: '800',
  },
  trustTitle: {
    color: '#141414',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  trustLine: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 7,
  },
  trustLineIcon: {
    width: 30,
    height: 30,
    borderRadius: 11,
    backgroundColor: '#E8F5F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustLineTitle: {
    flex: 1,
    color: '#141414',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  trustLineValue: {
    color: '#00736F',
    fontSize: 12,
    fontWeight: '800',
  },
  bottomNav: {
    minHeight: 72,
    borderTopWidth: 1,
    borderTopColor: '#eeeeee',
    backgroundColor: '#ffffff',
    paddingTop: 8,
    paddingHorizontal: 6,
    flexDirection: 'row',
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 3,
  },
  navActionItem: {
    marginTop: -10,
  },
  navActionCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#008F9A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: {
    color: '#8b8b8b',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
  navTextActive: {
    color: '#141414',
  },
});
