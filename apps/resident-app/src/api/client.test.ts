import * as api from './client';
import instance from './client';

jest.mock('axios', () => {
  const post = jest.fn(() => Promise.resolve({ data: {} }));
  const get = jest.fn(() => Promise.resolve({ data: {} }));
  const put = jest.fn(() => Promise.resolve({ data: {} }));
  return {
    __esModule: true,
    default: {
      create: () => ({
        get, post, put, delete: jest.fn(),
        defaults: { headers: { common: {} } },
        interceptors: { response: { use: jest.fn() }, request: { use: jest.fn() } },
      }),
    },
  };
});

describe('community api surface', () => {
  it('fetches one issue thread', () => {
    api.getIssue('i1');
    expect((instance.get as jest.Mock)).toHaveBeenCalledWith('/issues/i1');
  });

  it('posts a reply', () => {
    api.replyToIssue('i1', 'On it');
    expect((instance.post as jest.Mock)).toHaveBeenCalledWith('/issues/i1/replies', { body: 'On it' });
  });

  it('changes status with an optional assignee', () => {
    api.changeIssueStatus('i1', 'in_progress', 'Ramesh');
    expect((instance.put as jest.Mock)).toHaveBeenCalledWith('/issues/i1/status', {
      status: 'in_progress', assignee_name: 'Ramesh',
    });
  });

  it('omits assignee_name when not given', () => {
    api.changeIssueStatus('i1', 'resolved');
    expect((instance.put as jest.Mock)).toHaveBeenCalledWith('/issues/i1/status', { status: 'resolved' });
  });

  it('sends photos as multipart under the field name the server expects', () => {
    api.uploadIssuePhotos('i1', ['file:///a.jpg', 'file:///b.jpg']);
    const [url, form, config] = (instance.post as jest.Mock).mock.calls.at(-1)!;
    expect(url).toBe('/issues/i1/photos');
    expect(form).toBeInstanceOf(FormData);
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
  });

  it('creates an announcement with a priority', () => {
    api.createAnnouncement({ title: 'AGM', body: 'Sunday', priority: 'urgent' });
    expect((instance.post as jest.Mock)).toHaveBeenCalledWith('/notices', {
      title: 'AGM', body: 'Sunday', category: 'official', priority: 'urgent',
    });
  });

  it('creates a discussion under the discussion category', () => {
    api.createDiscussion({ title: 'Lift noise', body: 'Anyone else?' });
    expect((instance.post as jest.Mock)).toHaveBeenCalledWith('/notices', {
      title: 'Lift noise', body: 'Anyone else?', category: 'discussion',
    });
  });
});
