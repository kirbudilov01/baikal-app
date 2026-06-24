export const reportStatuses = {
  moderation: {
    label: 'На модерации',
    mobileHint: 'Модератор проверяет фото, описание и геоточку',
    adminAction: 'Проверить',
    terminal: false,
  },
  transferred: {
    label: 'Передано',
    mobileHint: 'Заявка передана ответственному координатору',
    adminAction: 'Назначить исполнителя',
    terminal: false,
  },
  in_progress: {
    label: 'В работе',
    mobileHint: 'Ответственные службы проверяют участок',
    adminAction: 'Контролировать исполнение',
    terminal: false,
  },
  resolved: {
    label: 'Решено',
    mobileHint: 'Проблема закрыта, баллы начислены',
    adminAction: 'Закрыто',
    terminal: true,
  },
  rejected: {
    label: 'Отклонено',
    mobileHint: 'Заявку нельзя подтвердить по текущим данным',
    adminAction: 'Закрыто',
    terminal: true,
  },
};

const transitions = {
  moderation: ['transferred', 'rejected'],
  transferred: ['in_progress', 'rejected'],
  in_progress: ['resolved', 'transferred'],
  resolved: [],
  rejected: [],
};

export function assertKnownStatus(status) {
  if (!reportStatuses[status]) {
    throw createDomainError(400, `Unknown status: ${status}`);
  }
}

export function assertCanTransition(from, to) {
  assertKnownStatus(from);
  assertKnownStatus(to);

  if (!transitions[from].includes(to)) {
    throw createDomainError(409, `Cannot move report from ${from} to ${to}`);
  }
}

export function publicStatus(status) {
  assertKnownStatus(status);
  return {
    code: status,
    label: reportStatuses[status].label,
    hint: reportStatuses[status].mobileHint,
    terminal: reportStatuses[status].terminal,
  };
}

export function createDomainError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

