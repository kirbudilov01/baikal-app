import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  ImageSourcePropType,
  Linking,
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

type MapPoint = LocationPoint & {
  label: string;
  area: string;
  top: `${number}%`;
  left: `${number}%`;
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

type Reward = {
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
const DRAFT_STORAGE_KEY = 'baikal-report-draft-v1';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const ADMIN_ENABLED = process.env.EXPO_PUBLIC_ADMIN_ENABLED === 'true';
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL || '';
const SUPPORT_URL = process.env.EXPO_PUBLIC_SUPPORT_URL || '';
const noWebOutline = { outlineStyle: 'none' } as unknown as ViewStyle;

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

const rewards: Reward[] = [
  { title: 'Чай у озера', partner: 'Кафе «У Озера»', cost: 350, benefit: 'напиток в подарок', note: 'забрать сегодня', image: rewardImage, icon: 'coffee-outline' },
  { title: 'Прокат велосипеда', partner: 'Листвянка Bike', cost: 800, benefit: '-20% на прогулку', note: '2 часа по берегу', image: heroImage, icon: 'bike' },
  { title: 'Эко-отель', partner: 'Байкал Дом', cost: 1200, benefit: '-10% на ночь', note: 'для выходных', image: rewardImage, icon: 'home-heart' },
];

const initialReports: Report[] = [
  {
    id: 1,
    publicId: 'BR-1024',
    title: 'Незаконная вырубка леса',
    category: 'Вырубка',
    location: 'Большое Голоустное',
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

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'API request failed');
  }

  return payload as T;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [selectedCategory, setSelectedCategory] = useState(categories[0].label);
  const [description, setDescription] = useState('');
  const [reports, setReports] = useState(initialReports);
  const [submittedReport, setSubmittedReport] = useState<Report | null>(null);
  const [pickedImage, setPickedImage] = useState<string | null>(null);
  const [pickedLocation, setPickedLocation] = useState<LocationPoint | null>(null);
  const [pickedLocationLabel, setPickedLocationLabel] = useState('');
  const [selectedReportId, setSelectedReportId] = useState(initialReports[0].id);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Локальный режим: backend пока не подключен');
  const [isSyncing, setIsSyncing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const balance = useMemo(
    () => 1250 + reports.reduce((sum, report) => sum + report.points, 0) - initialReports.reduce((sum, report) => sum + report.points, 0),
    [reports],
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
    setIsSyncing(true);
    try {
      const payload = await requestJson<{ reports: ApiReport[] }>('/api/reports');
      const apiReports = payload.reports.map(reportFromApi);
      setReports(apiReports.length > 0 ? apiReports : initialReports);
      if (apiReports[0]) setSelectedReportId(apiReports[0].id);
      setSyncMessage(apiReports.length > 0 ? 'Backend подключен: заявки синхронизированы' : 'Backend подключен: заявок пока нет');
    } catch {
      setSyncMessage('Локальный режим: запустите backend для синхронизации');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadReportsFromApi();
  }, []);

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

    try {
      const payload = await requestJson<{ report: ApiReport }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          title: localReport.title,
          category: localReport.category,
          description,
          locationText: localReport.location,
          latitude: pickedLocation?.latitude ?? 52.28697,
          longitude: pickedLocation?.longitude ?? 104.30502,
          photoUrl: pickedImage,
        }),
      });
      nextReport = reportFromApi(payload.report);
      setSyncMessage('Заявка отправлена в backend');
    } catch {
      setSyncMessage('Backend недоступен: заявка сохранена локально');
    }

    setReports([nextReport, ...reports]);
    setSubmittedReport(nextReport);
    setSelectedReportId(nextReport.id);
    clearDraft();
    setActiveTab('success');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.shell}>
        <ScrollView key={activeTab} ref={scrollRef} style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
          {activeTab === 'home' && (
            <HomeScreen balance={balance} reports={reports} onReport={() => setActiveTab('report')} onOpenReports={() => setActiveTab('messages')} />
          )}
          {activeTab === 'map' && <MapScreen reports={reports} />}
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
          {activeTab === 'messages' && <MessagesScreen reports={reports} selectedReportId={selectedReportId} onSelectReport={setSelectedReportId} />}
          {activeTab === 'profile' && <ProfileScreen balance={balance} reports={reports} />}
          {ADMIN_ENABLED && activeTab === 'admin' && (
            <AdminScreen
              reports={reports}
              syncMessage={syncMessage}
              isSyncing={isSyncing}
              onRefresh={loadReportsFromApi}
              onStatusChange={async (report, statusCode) => {
                try {
                  const payload = await requestJson<{ report: ApiReport }>(`/api/admin/reports/${report.publicId}/status`, {
                    method: 'POST',
                    headers: { 'x-admin-id': 'admin:mobile-web' },
                    body: JSON.stringify({ status: statusCode }),
                  });
                  const updated = reportFromApi(payload.report);
                  setReports((items) => items.map((item) => (item.publicId === updated.publicId ? updated : item)));
                  setSelectedReportId(updated.id);
                  setSyncMessage(`Статус ${updated.publicId}: ${updated.status}`);
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
  onReport,
  onOpenReports,
}: {
  balance: number;
  reports: Report[];
  onReport: () => void;
  onOpenReports: () => void;
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

      <RewardsSection balance={balance} />

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
    onPickLocation({ latitude: current.coords.latitude, longitude: current.coords.longitude });
    onPickLocationLabel('Текущее местоположение');
    setMapPickerOpen(true);
  };

  const chooseMapPoint = (point: MapPoint) => {
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
          onOpenMap={() => setMapPickerOpen(true)}
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
}: {
  reports: Report[];
  selectedReportId: number;
  onSelectReport: (id: number) => void;
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

      <ReportDetail report={selectedReport} />
    </View>
  );
}

function MapScreen({ reports }: { reports: Report[] }) {
  const [mapFilter, setMapFilter] = useState('Все');
  const [confirmedReportId, setConfirmedReportId] = useState<number | null>(null);
  const [selectedPointLabel, setSelectedPointLabel] = useState(mapPoints[0].label);
  const filters = ['Все', 'Вырубка', 'Мусор', 'Вода'];
  const filtered = reports.filter((report) => mapFilter === 'Все' || report.category === mapFilter);
  const visiblePoints = mapPoints.filter((point) => filtered.some((report) => report.location === point.label));
  const safePoints = visiblePoints.length > 0 ? visiblePoints : mapPoints;
  const selectedPoint = safePoints.find((point) => point.label === selectedPointLabel) ?? safePoints[0];
  const nearestReport = filtered.find((report) => report.location === selectedPoint.label) ?? filtered[0] ?? reports[0];
  const isConfirmed = confirmedReportId === nearestReport.id;
  const palette = getStatusPalette(nearestReport.status);

  const handleFilter = (item: string) => {
    const nextFiltered = reports.filter((report) => item === 'Все' || report.category === item);
    const nextReport = nextFiltered[0] ?? reports[0];
    setMapFilter(item);
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
              <Text style={styles.mapSheetText}>{nearestReport.confirmations + (isConfirmed ? 1 : 0)} подтверждений · {nearestReport.nextActionLabel}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
              <Text style={[styles.statusPillText, { color: palette.text }]}>{nearestReport.status}</Text>
            </View>
          </View>
          <Pressable style={[styles.mapConfirmButton, isConfirmed && styles.mapConfirmButtonDone]} onPress={() => setConfirmedReportId(nearestReport.id)}>
            <Text style={[styles.mapConfirmButtonText, isConfirmed && styles.mapConfirmButtonTextDone]}>
              {isConfirmed ? 'Спасибо, учли' : 'Я видел это место'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ProfileScreen({ balance, reports }: { balance: number; reports: Report[] }) {
  const openUrl = (url: string) => {
    if (!url) return;
    Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Бонусы" rightText={`${balance} листиков`} />
      <RewardsSection balance={balance} />

      <View style={styles.profileCard}>
        <Text style={styles.profileInitial}>К</Text>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>Участник проекта</Text>
          <Text style={styles.rowText}>Доверие растет за подтвержденные обращения</Text>
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
    </View>
  );
}

function AdminScreen({
  reports,
  syncMessage,
  isSyncing,
  onRefresh,
  onStatusChange,
}: {
  reports: Report[];
  syncMessage: string;
  isSyncing: boolean;
  onRefresh: () => void;
  onStatusChange: (report: Report, status: ReportStatusCode) => void;
}) {
  const activeReports = reports.filter((report) => report.statusCode !== 'resolved' && report.statusCode !== 'rejected');
  const moderationCount = reports.filter((report) => report.statusCode === 'moderation').length;
  const resolvedCount = reports.filter((report) => report.statusCode === 'resolved').length;

  return (
    <View style={styles.screen}>
      <AppHeader title="Админка" rightText={`${activeReports.length} активных`} />
      <View style={styles.adminNotice}>
        <MaterialCommunityIcons name="server-network" size={20} color="#00736F" />
        <View style={styles.rowCopy}>
          <Text style={styles.adminNoticeTitle}>{isSyncing ? 'Синхронизация...' : 'Контур управления'}</Text>
          <Text style={styles.adminNoticeText}>{syncMessage}</Text>
        </View>
        <Pressable style={styles.adminRefreshButton} onPress={onRefresh}>
          <MaterialCommunityIcons name="refresh" size={18} color="#141414" />
        </Pressable>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryCell label="Модерация" value={`${moderationCount}`} />
        <SummaryCell label="В работе" value={`${activeReports.length}`} />
        <SummaryCell label="Решено" value={`${resolvedCount}`} />
      </View>

      <View style={styles.listPanel}>
        {reports.map((report) => (
          <AdminReportCard key={report.publicId} report={report} onStatusChange={onStatusChange} />
        ))}
      </View>
    </View>
  );
}

function AdminReportCard({
  report,
  onStatusChange,
}: {
  report: Report;
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
        <View style={[styles.statusPill, { backgroundColor: getStatusPalette(report.status).bg }]}>
          <Text style={[styles.statusText, { color: getStatusPalette(report.status).text }]}>{report.status}</Text>
        </View>
      </View>
      <Text style={styles.adminCardText}>{report.nextStep}</Text>
      <View style={styles.adminActions}>
        {actions.length > 0 ? actions.map((action) => (
          <Pressable key={action.status} style={styles.adminActionButton} onPress={() => onStatusChange(report, action.status)}>
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

function RewardsSection({ balance }: { balance: number }) {
  const nextReward = rewards.find((reward) => reward.cost > balance);
  const targetCost = nextReward?.cost ?? rewards[rewards.length - 1].cost;
  const progress = Math.min(100, Math.round((balance / targetCost) * 100));
  const availableCount = rewards.filter((reward) => balance >= reward.cost).length;

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
        {rewards.map((reward) => (
          <RewardCard key={reward.title} reward={reward} available={balance >= reward.cost} />
        ))}
      </View>
    </View>
  );
}

function RewardCard({ reward, available }: { reward: Reward; available: boolean }) {
  return (
    <View style={[styles.rewardCard, !available && styles.rewardCardLocked]}>
      <View style={styles.rewardIcon}>
        <MaterialCommunityIcons name={reward.icon} size={22} color={available ? '#ffffff' : '#6b7280'} />
      </View>
      <View style={styles.rewardCopy}>
        <Text style={styles.rewardPartner}>{reward.partner}</Text>
        <Text style={styles.rewardTitle}>{reward.title}</Text>
        <Text style={styles.rewardBenefit}>{reward.benefit} · {reward.note}</Text>
      </View>
      <View style={[styles.rewardCost, available && styles.rewardCostAvailable]}>
        <Text style={[styles.rewardCostText, available && styles.rewardCostTextAvailable]}>
          {available ? 'Забрать' : `${reward.cost}`}
        </Text>
      </View>
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
  onChoosePoint: (point: MapPoint) => void;
}) {
  const activePoint = mapPoints.find(
    (point) => point.latitude === pickedLocation?.latitude && point.longitude === pickedLocation?.longitude,
  );

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
  const palette = getStatusPalette(report.status);

  return (
    <View style={[styles.reportRow, selected && styles.reportRowSelected]}>
      <Image source={report.image} style={styles.reportThumb} />
      <View style={styles.reportCopy}>
        <View style={styles.reportTopLine}>
          <Text style={styles.reportId}>{report.publicId}</Text>
          <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
            <Text style={[styles.statusText, { color: palette.text }]}>{report.status}</Text>
          </View>
        </View>
        <Text style={styles.reportTitle} numberOfLines={1}>{report.title}</Text>
        <Text style={styles.reportMeta} numberOfLines={1}>{report.location} · {report.date}</Text>
      </View>
    </View>
  );
}

function ReportDetail({ report }: { report: Report }) {
  return (
    <View style={styles.detailPanel}>
      <View style={styles.detailHero}>
        <Image source={report.image} style={styles.detailHeroImage} resizeMode="cover" />
        <LinearGradient colors={['rgba(0,0,0,0.02)', 'rgba(0,58,66,0.78)']} style={styles.detailHeroOverlay} />
        <View style={styles.detailHeroCopy}>
          <View style={[styles.detailHeroStatus, { backgroundColor: getStatusPalette(report.status).bg }]}>
            <Text style={[styles.detailHeroStatusText, { color: getStatusPalette(report.status).text }]}>{report.status}</Text>
          </View>
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
          <Pressable style={styles.detailActionButton}>
            <MaterialCommunityIcons name="check-circle-outline" size={17} color="#141414" />
            <Text style={styles.detailActionText}>Подтвердить</Text>
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
  adminActionButton: {
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    alignItems: 'center',
    justifyContent: 'center',
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
  trustPanel: {
    borderRadius: 18,
    backgroundColor: '#f5f6f7',
    padding: 14,
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
